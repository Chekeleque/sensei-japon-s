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

    /**
     * MODEL_ID sugeridos:
     * - "gemini-1.5-flash" (El estándar equilibrado)
     * - "gemini-1.5-flash-8b" (Es el modelo "Lite", más rápido y con mayor cuota)
     */
    const MODELS_TO_TRY = ["gemini-1.5-flash", "gemini-1.5-flash-8b"];
    const API_VERSION = "v1beta"; // Usamos v1beta para máxima compatibilidad con modelos Flash

    let lastError = null;

    for (const modelId of MODELS_TO_TRY) {
        const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${modelId}:generateContent?key=${API_KEY}`;
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts <= maxAttempts) {
            try {
                const response = await fetch(url, {
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
                            - Rigor: No inventes radicales ni significados.
                            - Integridad: No cortes la respuesta.` }]
                        }],
                        generationConfig: {
                            temperature: 0.2,
                            maxOutputTokens: 2048,
                            topP: 0.95,
                        }
                    })
                });

                const data = await response.json();

                // Si el modelo no existe (404), pasamos al siguiente modelo de la lista
                if (response.status === 404) {
                    lastError = `Modelo ${modelId} no encontrado (404).`;
                    break;
                }

                // Si hay error de cuota o servidor, reintentamos con espera
                if (response.status === 429 || response.status === 503) {
                    attempts++;
                    lastError = `Modelo ${modelId} saturado (${response.status}): ${data.error?.message || 'Servicio no disponible'}`;
                    
                    if (attempts <= maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
                        continue;
                    }
                    break; // Agotados los reintentos para este modelo, probamos el siguiente
                }

                if (!response.ok) {
                    throw new Error(data.error?.message || `Error HTTP ${response.status}`);
                }

                const candidate = data.candidates?.[0];
                if (candidate?.content?.parts?.[0]?.text) {
                    return res.status(200).json({ text: candidate.content.parts[0].text });
                }
                
                throw new Error(candidate?.finishReason || 'Respuesta vacía');

            } catch (err) {
                lastError = `${modelId} -> ${err.message}`;
                break; // Error fatal en este modelo, saltar al siguiente
            }
        }
    }

    return res.status(500).json({ 
        error: `No se pudo obtener respuesta de ningún modelo. Último error: ${lastError}` 
    });
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