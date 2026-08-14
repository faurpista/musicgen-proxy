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

// ==========================================
 // ==========================================
// ACE-STEP FREE AUDIO GENERATION (Gradio API)
// ==========================================
app.post("/api/generate-free-audio", async (req, res) => {
    console.log("=== ACE-STEP FREE AUDIO GENERÁLÁS ===");

    try {
        const { prompt, hfToken: tokenFromClient, apiKey } = req.body || {};
        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;

        if (!hfToken) {
            return res.status(401).json({
                success: false,
                error: "Hiányzó Hugging Face API token."
            });
        }

        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: "Hiányzó prompt."
            });
        }
        // 1. Feladat indítása
        console.log("📩 Beérkező kérés body:", req.body);

        const { 
            prompt, 
            hfToken: tokenFromClient, 
            apiKey, 
            duration,  // ⏱️ ÚJ: Hossz másodpercben
            lyrics     // 🎤 ÚJ: Dalszöveg (ha van)
        } = req.body || {};

        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;

        if (!hfToken) {
            return res.status(401).json({ success: false, error: "Hiányzó Hugging Face API token." });
        }

        if (!prompt) {
            return res.status(400).json({ success: false, error: "Hiányzó prompt." });
        }

        // Hossz beállítása (ha a kliens nem küldi, alapértelmezett 10 mp)
        const audioDuration = parseInt(duration) || 10;

        // Ha van dalszöveg, hozzáfűzzük a prompt kéréshez
        let finalPrompt = prompt;
        if (lyrics && lyrics.trim() !== "") {
            finalPrompt = `${prompt}\n\n${lyrics.trim()}`;
        }

        console.log(`🎵 Prompt: "${finalPrompt}"`);
        console.log(`⏱️ Időtartam: ${audioDuration} mp`);

        const SPACE = "https://victor-ace-step-jam.hf.space";

        // 1. Feladat indítása a dinamikus adatokkal
        const response = await fetch(`${SPACE}/gradio_api/call/create`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                data: [
                    finalPrompt,   // 0: Prompt + Dalszöveg
                    audioDuration, // 1: Kliens által kért hossz (mp)
                    -1,            // 2: Seed (-1 = random)
                    false          // 3: Thinking
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({
                success: false,
                step: "create",
                error: errorText
            });
        }

        const data = await response.json();
        const eventId = data.event_id;

        if (!eventId) {
            return res.status(500).json({
                success: false,
                error: "Nem érkezett event_id a Gradio API-tól."
            });
        }

        console.log("🆔 Event ID:", eventId);

        // 2. Eredmény megvárása Server-Sent Events (SSE) folyamon keresztül
        const resultResponse = await fetch(`${SPACE}/gradio_api/call/create/${eventId}`, {
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Accept": "text/event-stream"
            }
        });

        if (!resultResponse.ok) {
            const errorText = await resultResponse.text();
            return res.status(resultResponse.status).json({
                success: false,
                step: "result",
                error: errorText
            });
        }

        const resultText = await resultResponse.text();
        const blocks = resultText.split("\n\n").filter(Boolean);

        let result = null;
        for (const block of blocks) {
            if (block.includes("event: complete")) {
                const dataLine = block.split("\n").find(line => line.startsWith("data:"));
                if (dataLine) {
                    result = JSON.parse(dataLine.substring(5).trim());
                    break;
                }
            }
        }

        if (!result) {
            return res.status(500).json({
                success: false,
                error: "A generálás lefutott, de nem érkezett 'complete' esemény."
            });
        }

        // 3. Audio Data URL kinyerése és konvertálása Buffer-ré
        let output = Array.isArray(result) ? result[0] : result;
        if (typeof output === "string") {
            try { output = JSON.parse(output); } catch {}
        }

        if (!output?.audio) {
            return res.status(500).json({
                success: false,
                error: "Nem található audio adat az kimenetben.",
                output
            });
        }

        const commaIndex = output.audio.indexOf(",");
        if (commaIndex === -1) {
            return res.status(500).json({ success: false, error: "Hibás Data URL formátum." });
        }

        const base64Data = output.audio.substring(commaIndex + 1);
        const buffer = Buffer.from(base64Data, "base64");

        console.log(`✅ Sikeres generálás! Méret: ${buffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", buffer.length);
        res.send(buffer);

    } catch (error) {
        console.error("❌ ACE-STEP SERVER EXCEPTION:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});   

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
