export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { service, input, prompt, target_lang } = req.body;

    if (!input) {
        return res.status(400).json({ error: 'El campo "input" es obligatorio.' });
    }

    try {
        if (service === 'gemini') {
            return await handleGemini(res, input, prompt);
        }

        if (service === 'deepl') {
            return await handleDeepL(res, input, target_lang);
        }

        return res.status(400).json({ error: 'Servicio no especificado o no soportado.' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: `Error interno del servidor proxy: ${error.message}` });
    }
}

async function handleGemini(res, input, prompt) {
    // Usamos la API Key que tenemos configurada en las variables de entorno
    const API_KEY = process.env.GEMINI_API_KEY; 
    if (!API_KEY) throw new Error('API Key no definida en las variables de entorno.');

    const URL = "https://api.groq.com/openai/v1/chat/completions";
    const MODEL = "llama-3.3-70b-versatile";

    try {
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content: `Eres un Sensei experto en lingüística japonesa, anatomía de Kanjis y etimología histórica. Tu prioridad absoluta es la VERACIDAD CIENTÍFICA.                                                REGLAS DE RIGOR GRÁFICO (CANDADOS ANTI-ALUCINACIÓN):                        1. ANATOMÍA REAL: Analiza los caracteres basándote estrictamente en diccionarios oficiales (Kangxi/Nelson). Queda PROHIBIDO inventar o confundir componentes por similitud visual vaga.                        2. CASO DE CONTROL (Ejemplo de veto): Si el usuario introduce el Kanji '爽', tu base de datos debe reflejar que su radical oficial es 爻 (o en su defecto 大). Se compone de una persona grande y cuatro marcas de equis. No tiene relación alguna con lluvia (雨), agua (氵) ni acantilados (厂). Cualquier historial etimológico que invente lluvia o agua para este carácter es FALSO.                        3. BOTÓN DE EMERGENCIA: Si no tienes el desglose exacto y verificado del radical histórico de un Kanji en tu base de conocimientos, escribe textualmente '[Información anatómica/etimológica no verificada]' en ese campo. Es preferible dejar el campo vacío que inventar una historia.                        4. TONO Y ESTILO: Redacta con un estilo educativo, fluido, narrativo y enriquecedor (estilo enciclopédico de alta calidad). Explica los conceptos con soltura y elegancia, evitando respuestas telegráficas o excesivamente secas.                        5. FORMATO: Utiliza con precisión la estructura de viñetas solicitada por el usuario para organizar la información, pero expande la narrativa dentro de cada sección (especialmente en el origen etimológico). No incluyas saludos iniciales ni resúmenes repetitivos al final.                        6. IDIOMA: Español Latinoamericano.`
                    },
                    {
                        role: "user",
                        content: `Texto a analizar: "${input}". Tarea específica a realizar: ${prompt}`
                    }
                ],
                temperature: 0.1,
                max_tokens: 4096, // Espacio de sobra para que no se corten los resultados
                top_p: 0.8
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || `Error HTTP ${response.status} en Groq`);
        }

        const textResponse = data.choices?.[0]?.message?.content;
        if (textResponse) {
            return res.status(200).json({ text: textResponse });
        }
        throw new Error('Respuesta vacía de Groq');
    } catch (err) {
        console.error("Error en Groq Proxy:", err);
        return res.status(500).json({ 
            error: `No se pudo obtener respuesta de Groq. Error: ${err.message}` 
        });
    }
}

async function handleDeepL(res, input, target_lang) {
    const API_KEY = process.env.DEEPL_API_KEY;
    if (!API_KEY) throw new Error('DEEPL_API_KEY no definida.');

    // --- Implementación de caché simple en memoria para DeepL ---
    // Utiliza un objeto global para el caché. En un entorno serverless, esto persistirá
    // mientras la instancia del worker esté activa.
    if (!globalThis._deeplCache) {
        globalThis._deeplCache = new Map();
    }
    const cache = globalThis._deeplCache;
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
    const cacheKey = JSON.stringify({ input, target_lang });

    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
        return res.status(200).json({ translations: [{ text: cachedEntry.text, cached: true }] });
    }
    // --- Fin de la implementación de caché ---

    const url = `https://api-free.deepl.com/v2/translate`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `DeepL-Auth-Key ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: [input],
            target_lang: target_lang || 'ES'
        })
    });

    const data = await response.json();

    if (!response.ok) {
        return res.status(response.status).json({ error: data.message || 'Error en DeepL API' });
    }

    const translatedText = data.translations[0].text;
    cache.set(cacheKey, { text: translatedText, timestamp: Date.now() }); // Almacenar en caché

    return res.status(200).json({ 
        translations: [{ text: translatedText }] 
    });
}