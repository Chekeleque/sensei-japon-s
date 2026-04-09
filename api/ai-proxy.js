export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { service, input, prompt, target_lang } = req.body;

    try {
        if (service === 'gemini') {
            const API_KEY = process.env.GEMINI_API_KEY;
            if (!API_KEY) {
                return res.status(500).json({ error: 'Error de configuración: GEMINI_API_KEY no está definida en Vercel.' });
            }

            // 1. Buscar automáticamente un modelo disponible
            const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
            const listData = await listResp.json();
            
            if (!listResp.ok) {
                return res.status(listResp.status).json({ error: listData.error?.message || 'No se pudo obtener la lista de modelos de Gemini.' });
            }

            const modelObj = listData.models?.find(m => m.name.includes("gemini-1.5-flash") && m.supportedGenerationMethods.includes("generateContent"))
                          || listData.models?.find(m => m.supportedGenerationMethods.includes("generateContent"));

            if (!modelObj) {
                return res.status(404).json({ error: 'No se encontró ningún modelo de Gemini compatible con generateContent en tu cuenta.' });
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/${modelObj.name}:generateContent?key=${API_KEY}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: `Actúa como un profesor de japonés experto. Texto: "${input}". Tarea: ${prompt}. Responde en ESPAÑOL LATINOAMERICANO fluido. Usa Kanji(Hiragana).` }]
                    }]
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // Si el estado HTTP no es OK, extrae el mensaje de error de la respuesta de Gemini
                const errorMessage = data.error?.message || `Error desconocido de Gemini (HTTP ${response.status})`;
                return res.status(response.status).json({ error: errorMessage });
            }
            
            if (data.candidates && data.candidates[0].content) {
                return res.status(200).json({ text: data.candidates[0].content.parts[0].text });
            } else {
                // Maneja el caso de una respuesta HTTP exitosa pero sin contenido generado
                return res.status(500).json({ error: 'Respuesta inesperada de Gemini: no se encontró contenido generado.' });
            }
        }

        if (service === 'deepl') {
            const API_KEY = process.env.DEEPL_API_KEY;
            if (!API_KEY) {
                return res.status(500).json({ error: 'Error de configuración: DEEPL_API_KEY no está definida en Vercel.' });
            }
            const url = `https://api-free.deepl.com/v2/translate`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: [input],
                    target_lang: target_lang || 'ES-MX'
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // Si el estado HTTP no es OK, extrae el mensaje de error de la respuesta de DeepL
                const errorMessage = data.message || `Error desconocido de DeepL (HTTP ${response.status})`;
                return res.status(response.status).json({ error: errorMessage });
            }

            return res.status(200).json({ 
                translations: [{ text: data.translations[0].text }] 
            });
        }

        return res.status(400).json({ error: 'Servicio no especificado o no soportado.' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: `Error interno del servidor proxy: ${error.message}` });
    }
}