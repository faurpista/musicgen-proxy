const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/generate-audio', async (req, res) => {
    try {
        const { prompt, hfToken } = req.body;

        if (!hfToken) {
            return res.status(400).json({ error: "Hiányzó HuggingFace API token!" });
        }

        console.log("Kérés érkezett a promptra:", prompt);

        // 🟢 GARANTÁLTAN AKTÍV SERVERLESS MODELL (Suno Bark Small)
        const hfUrl = "https://router.huggingface.co/models/suno/bark-small";

        const hfResponse = await fetch(hfUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ inputs: prompt })
        });

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            console.error(`HuggingFace API hiba (${hfResponse.status}):`, errText);
            
            return res.status(hfResponse.status).json({
                error: `HuggingFace hiba (${hfResponse.status}): ${errText}`
            });
        }

        const arrayBuffer = await hfResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.set('Content-Type', 'audio/wav');
        res.send(buffer);

    } catch (error) {
        console.error("Szerver belső hiba:", error);
        res.status(500).json({ error: `Belső szerverhiba: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy szerver fut a ${PORT} porton`));
