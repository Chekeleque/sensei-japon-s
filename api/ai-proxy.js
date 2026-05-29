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
    const API_KEY = process.env.GEMINI_API_KEY; 
    if (!API_KEY) throw new Error('La variable de entorno GEMINI_API_KEY no está configurada.');

    // Usamos el endpoint estable v1 para evitar conflictos de enrutamiento con v1main
    const URL = "https://generativelanguage.googleapis.com/v1/openai/chat/completions";
    const MODEL = "gemini-1.5-flash"; 

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
                        content: `Adopta de forma obligatoria la personalidad de un profesor de japonés experto, carismático y entusiasta. 

                        REQUISITOS LINGÜÍSTICOS:
                        - Tu nivel de japonés y etimología debe ser 100% real y académico. Prohibido inventar partículas o desglosar palabras como "こんにちは" en letras individuales. Explica que viene de "今日 (Konnichi)" + la partícula "は (wa)".
                        - Si se solicita información de un Kanji (como trazos, radicales o JLPT), extrae los datos reales. Si dudas, escribe '[Información no verificada]'.

                        ESTILO Y FORMATO:
                        - Comienza SIEMPRE con un saludo natural de profesor para introducir el tema (Ej: "¡Hola a todos! Como su profesor de japonés...").
                        - Diseña la respuesta de manera muy intuitiva y visual utilizando títulos claros en Markdown (###) y negritas.
                        - En las lecturas técnicas usa KATAKANA para Onyomi e HIRAGANA para Kunyomi.
                        - En el vocabulario usa el formato plano: 'Kanji(Kana) - Significado'. Ej: 車庫(しゃこ) - garaje.
                        - Idioma: Español Latinoamericano.`
                    },
                    {
                        role: "user",
                        content: `Texto a analizar: "${input}". Tarea: ${prompt}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 4096
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Detalles del error de Google:", JSON.stringify(data, null, 2));
            throw new Error(data.error?.message || `Error HTTP ${response.status}: ${JSON.stringify(data)}`);
        }

        const textResponse = data.choices?.[0]?.message?.content;
        if (textResponse) {
            return res.status(200).json({ text: textResponse });
        }
        throw new Error('Respuesta vacía');
    } catch (err) {
        console.error("Error en Gemini Proxy:", err);
        return res.status(500).json({ 
            error: `Error en el Sensei: ${err.message}` 
        });
    }
}

async function handleDeepL(res, input, target_lang) {
    const API_KEY = process.env.DEEPL_API_KEY;
    if (!API_KEY) throw new Error('La variable de entorno DEEPL_API_KEY no está configurada.');

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