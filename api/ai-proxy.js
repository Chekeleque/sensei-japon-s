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
    if (!API_KEY) throw new Error('GEMINI_API_KEY no definida.');

    // Usamos el endpoint v1 estable. Si persiste el error "not found", 
    // verifica que tu API Key sea de Google AI Studio (https://aistudio.google.com/)
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `Actúa como un Sensei experto en etimología japonesa.
                Analiza el texto: "${input}". 
                Tarea adicional: ${prompt}.

                REGLAS DE ORO PARA KANJI:
                1. RADICAL (Bushu): Identifica el radical principal según el sistema Kangxi. Explica su significado y qué aporta al kanji actual.
                2. SIGNIFICADO: Define el concepto principal y matices de uso.
                3. LECTURAS: Onyomi (en Katakana) y Kunyomi (en Hiragana).
                4. FICHA TÉCNICA: Número de trazos y nivel JLPT (N5 a N1).
                5. VOCABULARIO: Proporciona 3 palabras compuestas reales con su lectura y traducción.

                REQUISITOS DE FORMATO:
                - Idioma: Español Latinoamericano.
                - Rigor técnico: No inventes componentes ni significados. 
                - No cortes la respuesta.` }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
                topP: 0.95,
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const status = response.status;
        if (status === 503 || status === 429) {
            return res.status(status).json({ error: 'Google está saturado. Reintenta en unos segundos.' });
        }
        return res.status(status).json({ error: data.error?.message || 'Error en Gemini API' });
    }

    const candidate = data.candidates?.[0];
    if (candidate?.content?.parts?.[0]?.text) {
        return res.status(200).json({ text: candidate.content.parts[0].text });
    }

    // Manejo de bloqueos por seguridad o respuestas vacías
    const finishReason = candidate?.finishReason || 'UNKNOWN';
    return res.status(500).json({ error: `No se generó contenido. Razón: ${finishReason}` });
}

async function handleDeepL(res, input, target_lang) {
    const API_KEY = process.env.DEEPL_API_KEY;
    if (!API_KEY) throw new Error('DEEPL_API_KEY no definida.');

    // --- Implementación de caché simple en memoria para DeepL ---
    // Utiliza un objeto global para el caché. En un entorno serverless, esto persistirá
    // mientras la instancia del worker esté activa.
    const cache = global._deeplCache = global._deeplCache || new Map();
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
    const cacheKey = JSON.stringify({ input, target_lang });

    if (cache.has(cacheKey) && (Date.now() - cache.get(cacheKey).timestamp < CACHE_TTL_MS)) {
        return res.status(200).json({ translations: [{ text: cache.get(cacheKey).text, cached: true }] });
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