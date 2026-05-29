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

    // Cambiamos a la API Nativa de Google (v1 estable) para resolver el error de versión 404
    const URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    try {
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ 
                        text: `INSTRUCCIONES DE SISTEMA:
                        Adopta de forma obligatoria la personalidad de un profesor de japonés experto, carismático y entusiasta. 

                        REQUISITOS LINGÜÍSTICOS:
                        - Nivel 100% real y académico. Prohibido inventar partículas o desglosar "こんにちは" en letras. Explica que viene de "今日 (Konnichi)" + "は (wa)".
                        - Datos reales de Kanji (trazos, radicales, JLPT). Si dudas, escribe '[Información no verificada]'.

                        ESTILO Y FORMATO:
                        - Saludo natural de profesor inicial.
                        - Markdown (###) y negritas.
                        - Onyomi en KATAKANA, Kunyomi en HIRAGANA.
                        - Vocabulario: 'Kanji(Kana) - Significado'.
                        - Idioma: Español Latinoamericano.

                        ---
                        Texto a analizar: "${input}". 
                        Tarea: ${prompt}` 
                    }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 4096
                }
            })
        });

        const responseText = await response.text();
        if (!responseText) {
            throw new Error(`El servidor devolvió una respuesta vacía (Status: ${response.status})`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`La respuesta no es un JSON válido (Status: ${response.status}). Contenido: ${responseText.substring(0, 200)}`);
        }

        if (!response.ok) {
            console.error("Detalles del error de Google:", JSON.stringify(data, null, 2));
            throw new Error(data.error?.message || `Error HTTP ${response.status}`);
        }

        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
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

    const responseText = await response.text();
    if (!responseText) {
        throw new Error(`DeepL devolvió una respuesta vacía (Status: ${response.status})`);
    }

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Respuesta de DeepL no válida (Status: ${response.status})`);
    }

    if (!response.ok) {
        throw new Error(data.message || `Error en DeepL API (${response.status})`);
    }

    const translatedText = data.translations[0].text;
    cache.set(cacheKey, { text: translatedText, timestamp: Date.now() }); // Almacenar en caché

    return res.status(200).json({ 
        translations: [{ text: translatedText }] 
    });
}