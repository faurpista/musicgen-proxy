const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Client } = require("@gradio/client");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================
// 1. ZENE GENERÁLÁS (Hugging Face Inference API)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    console.log("=== GENERATE AUDIO HÍVÁS (MusicGen) ===");

    try {
        const { prompt, apiKey, hfToken: tokenFromClient } = req.body || {};

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt!" });
        }

        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;
        if (!hfToken) {
            return res.status(400).json({ error: "Hiányzó Hugging Face API kulcs!" });
        }

        console.log(`🎶 Zene generálása: "${prompt}"...`);

        const MODEL_NAME = "facebook/musicgen-small";
        const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL_NAME}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: prompt,
                options: { wait_for_model: true }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Hugging Face API hiba:", response.status, errorText);
            return res.status(response.status).json({
                error: `Hugging Face Hiba (${response.status}): ${errorText}`
            });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`✅ Zene sikeresen legyártva! Méret: ${buffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", buffer.length);
        res.send(buffer);

    } catch (err) {
        console.error("❌ SERVER EXCEPTION:", err);
        res.status(500).json({ error: `Szerver hiba: ${err.message}` });
    }
});

// ==========================================
// 2. ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client)
// ==========================================
// ==========================================
// 2. ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client)
// ==========================================
app.post("/api/generate-free-audio", async (req, res) => {
    console.log("=== ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client) ===");

    try {
        const { 
            prompt, 
            hfToken: tokenFromClient, 
            apiKey, 
            duration,  
            lyrics     
        } = req.body || {};

        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;

        if (!hfToken) {
            return res.status(401).json({ success: false, error: "Hiányzó Hugging Face API token." });
        }

        if (!prompt) {
            return res.status(400).json({ success: false, error: "Hiányzó prompt." });
        }

        const audioDuration = Number(duration) || 7;

        let finalPrompt = prompt;
        if (lyrics && typeof lyrics === "string" && lyrics.trim() !== "") {
            finalPrompt = `${prompt}\n\n${lyrics.trim()}`;
        }

        console.log(`🎵 Csatlakozás a Space-hez... Prompt: "${finalPrompt}" (${audioDuration}s)`);

        // 1. Csatlakozás a Hugging Face Space-hez
        const client = await Client.connect("victor/ace-step-jam", {
            hf_token: hfToken
        });

        const apiPayload = [
            finalPrompt,        // 0: Prompt + Dalszöveg
            audioDuration,      // 1: Hossz másodpercben
            -1,                 // 2: Seed
            false               // 3: Thinking
        ];

        let result;

        // 2. Generálás futtatása okos hibakezeléssel
        try {
            result = await client.predict(0, apiPayload);
        } catch (err) {
            const errMsg = err.message || "";
            console.error("❌ Gradio hiba történt:", errMsg);

            // Ha kimerült a ZeroGPU keret, nem próbálkozunk tovább
            if (errMsg.includes("ZeroGPU") || errMsg.includes("exceeded your ZeroGPU")) {
                return res.status(429).json({
                    success: false,
                    error: "Kimerült a Hugging Face ZeroGPU napi kereted erre az API tokenre! Használj egy másik HF tokent, vagy próbáld újra később."
                });
            }

            // Ha nem ZeroGPU hiba volt, megpróbáljuk a '/create' végpontot
            try {
                result = await client.predict("/create", apiPayload);
            } catch (err2) {
                return res.status(500).json({
                    success: false,
                    error: `Gradio API hiba: ${err2.message || errMsg}`
                });
            }
        }

        console.log("✅ Generálás kész, válasz feldolgozása...");

        // 3. Audio adatok kinyerése
        const audioData = result?.data?.[0];

        if (!audioData) {
            return res.status(500).json({ 
                success: false, 
                error: "A Hugging Face Space lefutott, de nem küldött audio adatot." 
            });
        }

        let audioBuffer;
        if (typeof audioData === "object" && audioData.url) {
            const audioFetch = await fetch(audioData.url);
            const arrayBuf = await audioFetch.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuf);
        } else if (typeof audioData === "string" && audioData.startsWith("data:audio")) {
            const base64Data = audioData.split(",")[1];
            audioBuffer = Buffer.from(base64Data, "base64");
        } else {
            return res.status(500).json({ success: false, error: "Ismeretlen audio formátum érkezett." });
        }

        console.log(`🎧 Visszaküldés a kliensnek! Méret: ${audioBuffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        res.send(audioBuffer);

    } catch (error) {
        console.error("❌ SERVER EXCEPTION:", error);
        res.status(500).json({ 
            success: false, 
            error: `Szerver hiba: ${error.message || "Ismeretlen hiba történt."}` 
        });
    }
});


// ==========================================
// 3. SZÖVEG / DALSZÖVEG GENERÁLÁS (Hugging Face LLM)
// ==========================================
app.post("/api/generate-text", async (req, res) => {
    console.log("=== DALSZÖVEG GENERÁLÁS (Hugging Face LLM) ===");

    try {
        const { prompt, hfToken: tokenFromClient, apiKey } = req.body || {};

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt!" });
        }

        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;

        if (!hfToken) {
            return res.status(400).json({ error: "Hiányzó Hugging Face API kulcs!" });
        }

        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-72B-Instruct", 
                messages: [
                    {
                        role: "system",
                        content: "You are a professional AI songwriter. Write catchy, structured song lyrics with [Verse], [Chorus], [Bridge], [Outro] tags. Output ONLY the lyrics without extra intro or commentary."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 600,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Hugging Face Text API hiba:", response.status, errorText);
            return res.status(response.status).json({
                error: `Hugging Face Hiba (${response.status}): ${errorText}`
            });
        }

        const data = await response.json();
        const generatedText = data.choices?.[0]?.message?.content || "";

        console.log("✅ Dalszöveg sikeresen legyártva!");
        res.json({ result: generatedText });

    } catch (err) {
        console.error("❌ SERVER EXCEPTION:", err);
        res.status(500).json({ error: `Szerver hiba: ${err.message}` });
    }
});

// Szerver indítása
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
