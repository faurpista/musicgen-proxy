const express = require('express');
const cors = require('cors');

const app = express();

// Engedélyezzük a kéréseket a GitHub Pages oldaladról
app.use(cors());
app.use(express.json());

app.post('/api/generate-audio', async (req, res) => {
    try {
        const { prompt, hfToken } = req.body;

        if (!hfToken) {
            return res.status(400).json({ error: "Hiányzó API token" });
        }

        // A szerver hívja meg a HF-et (Itt NINCS CORS blokkolás!)
        const hfResponse = await fetch("https://api-inference.huggingface.co/models/facebook/musicgen-small", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ inputs: prompt })
        });

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            return res.status(hfResponse.status).send(errText);
        }

        // Az audio választ továbbítjuk a GitHub Pages frontendnek
        const arrayBuffer = await hfResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.set('Content-Type', 'audio/wav');
        res.send(buffer);

    } catch (error) {
        console.error("Server proxy error:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy szerver fut a ${PORT} porton`));
