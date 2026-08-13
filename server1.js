const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.post("/api/p/generate-audio", async (req, res) => {
    try {
        const { prompt, apiKey } = req.body;

        if (!prompt) {
            return res.status(400).json({ 
                error: "Hiányzó prompt" 
            });
        }

        // A DeepInfra API kulcs származhat a kérésből vagy környezeti változóból
        const deepinfraToken = apiKey || process.env.DEEPINFRA_TOKEN;

        if (!deepinfraToken) {
            return res.status(400).json({ 
                error: "Hiányzó DeepInfra API kulcs!" 
            });
        }

        console.log("🎶 Zene generálása a DeepInfra API-val...");

        // 1. Kérés küldése a DeepInfra MusicGen modelljének
        const response = await fetch(
            "https://api.deepinfra.com/v1/inference/facebook/musicgen-small",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${deepinfraToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    prompt: prompt,
                    duration: 10 // A zene hossza másodpercben
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.audio) {
            console.error("DeepInfra API hiba:", data);
            return res.status(response.status || 500).json({
                error: data.detail || data.error || "Generálási hiba a DeepInfra szerverén"
            });
        }

        // 2. Ha a DeepInfra egy audió URL-t ad vissza
        const audioUrl = data.audio;
        console.log("📥 Audió letöltése innen:", audioUrl);

        // Letöltjük az elkészült hangfájlt
        const audioResponse = await fetch(audioUrl);
        const buffer = Buffer.from(await audioResponse.arrayBuffer());

        // 3. Bináris audió válasz továbbítása a kliensnek
        res.setHeader("Content-Type", "audio/wav");
        res.send(buffer);

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.status(500).json({
            error: `Szerver hiba: ${err.message}`
        });
    }
});


app.post("/api/generate-text", async (req, res) => {

    console.log("=== GENERATE TEXT HÍVÁS ===");
    console.log(req.body);

    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Hiányzó prompt"
            });
        }

        const response = await fetch(
            "https://gen.pollinations.ai/text/" +
            encodeURIComponent(prompt)
        );

        console.log("Status:", response.status);

        const text = await response.text();

        console.log("Válasz:", text.substring(0,200));

        if (!response.ok) {
            return res.status(response.status).json({
                error: text
            });
        }

        res.json({
            result: text
        });

    } catch(err) {
        console.error("SERVER ERROR:", err);

        res.status(500).json({
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        "Server running on port",
        PORT
    );
});
