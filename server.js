const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" })); // Növelt limit a biztonság kedvéért

// ==========================================
// 1. ZENE GENERÁLÁS (DeepInfra MusicGen)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    try {
        const { prompt, apiKey } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt" });
        }

        const deepinfraToken = apiKey || process.env.DEEPINFRA_TOKEN;

        if (!deepinfraToken) {
            return res.status(400).json({ 
                error: "Hiányzó DeepInfra API kulcs!" 
            });
        }

        console.log("🎶 Zene generálása a DeepInfra API-val...");

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

        let buffer;
        const audioData = data.audio;

        // FONTOS: Megnézzük, hogy Data URI-t, HTTP URL-t vagy nyers Base64-et kaptunk
        if (typeof audioData === "string" && audioData.startsWith("data:")) {
            // Data URI pl: "data:audio/wav;base64,UklGR..."
            console.log("📦 Data URI érzékelve, átalakítás Buffer-ré...");
            const base64String = audioData.split(",")[1];
            buffer = Buffer.from(base64String, "base64");
        } else if (typeof audioData === "string" && audioData.startsWith("http")) {
            // Sima letölthető HTTP URL
            console.log("📥 Audió letöltése innen:", audioData);
            const audioResponse = await fetch(audioData);
            buffer = Buffer.from(await audioResponse.arrayBuffer());
        } else {
            // Nyers Base64 string
            console.log("📦 Nyers Base64 érzékelve...");
            buffer = Buffer.from(audioData, "base64");
        }

        // Bináris audió válasz küldése
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", buffer.length);
        res.send(buffer);

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.status(500).json({
            error: `Szerver hiba: ${err.message}`
        });
    }
});


// ==========================================
// 2. SZÖVEG GENERÁLÁS (Pollinations AI)
// ==========================================
app.post("/api/generate-text", async (req, res) => {
    console.log("=== GENERATE TEXT HÍVÁS ===");

    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt" });
        }

        // Stabilitási javítás: POST kérést küldünk a Pollinations szöveg API-jára
        const response = await fetch("https://text.pollinations.ai/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "user", content: prompt }
                ]
            })
        });

        const text = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({ error: text });
        }

        res.json({ result: text });

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
