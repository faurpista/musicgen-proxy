const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================
// 1. ZENE GENERÁLÁS (Hugging Face API)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    console.log("=== GENERATE AUDIO HÍVÁS (Hugging Face) ===");

    try {
        const { prompt, apiKey, hfToken: tokenFromClient } = req.body;

        if (!prompt) {
            console.error("❌ Hiba: Hiányzó prompt!");
            return res.status(400).json({ error: "Hiányzó prompt" });
        }

        // Hugging Face API Token (hf_...)
        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;
        if (!hfToken) {
            console.error("❌ Hiba: Hiányzó HF_TOKEN!");
            return res.status(400).json({ error: "Hiányzó Hugging Face API kulcs!" });
        }

        console.log(`🎶 Zene generálása a Hugging Face-en: "${prompt}"...`);

        // Hugging Face Inference API kérés
        const MODEL_NAME = "facebook/musicgen-small"; // vagy musicgen-medium / musicgen-large

const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL_NAME}`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${hfToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: prompt, // FONTOS: Hugging Face-nél 'inputs' kell, nem 'prompt'!
                    options: {
                        wait_for_model: true // Megvárja, amíg a HF betölti a modellt a memóriába
                    }
                })
            }
        );

        // Ha a Hugging Face hibát dob (pl. rossz API kulcs, hiányzó paraméter)
        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Hugging Face API hiba:", response.status, errorText);
            return res.status(response.status).json({
                error: `Hugging Face Hiba (${response.status}): ${errorText}`
            });
        }

        // A Hugging Face közvetlenül az audio/wav bináris adatát adja vissza
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`✅ Zene sikeresen legyártva! Méret: ${buffer.length} bájt`);

        // Válasz visszaküldése a kliensnek
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", buffer.length);
        res.send(buffer);

    } catch (err) {
        console.error("❌ SERVER EXCEPTION:", err);
        res.status(500).json({ error: `Szerver hiba: ${err.message}` });
    }
});


// ==========================================
// 2. SZÖVEG GENERÁLÁS (Pollinations AI)
// ==========================================
app.post("/api/generate-text", async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt" });
        }

        const response = await fetch(
            `https://text.pollinations.ai/${encodeURIComponent(prompt)}`
        );

        const text = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({ error: text });
        }

        res.json({ result: text });

    } catch (err) {
        console.error("❌ SERVER EXCEPTION:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
