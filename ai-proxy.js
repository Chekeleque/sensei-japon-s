export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { service, input, prompt, target_lang } = req.body;

    try {
        if (service === 'gemini') {
            const API_KEY = process.env.GEMINI_API_KEY;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

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
            if (data.error) return res.status(500).json({ error: data.error.message });
            
            return res.status(200).json({ text: data.candidates[0].content.parts[0].text });
        }

        if (service === 'deepl') {
            const API_KEY = process.env.DEEPL_API_KEY;
            // Nota: Usa api-free.deepl.com si tienes cuenta gratuita
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
            if (!response.ok) return res.status(500).json({ error: 'Error en DeepL' });

            return res.status(200).json({ 
                translations: [{ text: data.translations[0].text }] 
            });
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor proxy' });
    }
}