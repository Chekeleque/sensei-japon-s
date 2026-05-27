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

    // Si "gemini-1.5-flash" te sigue dando error de "not found", 
    // prueba a cambiarlo por "gemini-1.5-flash-8b" (que es la versión Lite).
    const MODEL_ID = "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${API_KEY}`;

    let response;
    let attempts = 0;
    const maxAttempts = 2; // Reintentar hasta 2 veces si está saturado

    while (attempts <= maxAttempts) {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `Eres un Sensei experto en lingüística japonesa y etimología.
                    Analiza con precisión técnica el texto: "${input}". 
                    Tarea: ${prompt}.

                    REGLAS OBLIGATORIAS PARA KANJI:
                    1. RADICAL (Bushu): Identifica el radical principal (Kangxi). Indica su nombre, significado y posición técnica (ej. hen, tsukuri, kammuri).
                    2. COMPONENTES: Desglosa otros elementos visuales si existen.
                    3. SIGNIFICADO: Concepto principal y matices.
                    4. LECTURAS: Onyomi (en Katakana) y Kunyomi (en Hiragana).
                    5. FICHA TÉCNICA: Trazos y nivel JLPT.
                    6. VOCABULARIO: 3 ejemplos reales con lectura y traducción.

                    REQUISITOS DE FORMATO:
                    - Idioma: Español Latinoamericano.
                    - Rigor: No inventes radicales ni significados. Si el texto no es un Kanji, analízalo como gramática o vocabulario general.
                    - Integridad: No cortes la respuesta.` }]
                }],
                generationConfig: {
                    temperature: 0.2, // Más bajo = más preciso/técnico
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

        if (response.status === 429 || response.status === 503) {
            attempts++;
            if (attempts <= maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
                continue;
            }
        }
        break;
    }

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