const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Client } = require("@gradio/client");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================
// 1. ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client)
// ≈=====≈======≈============================
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

        // 1. Megpróbáljuk az ACE-Step Space-t
        try {
            result = await client.predict(0, apiPayload);
        } catch (err) {
            console.warn("⚠️ HF Space / ZeroGPU hiba, azonnali átállás Pollinations-re:", err.message);

            // 2. Hiba (pl. ZeroGPU keret) esetén azonnal elindul a Pollinations tartalék
            try {
                const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?model=audio&seed=${Math.floor(Math.random() * 1000)}`;
                const pollFetch = await fetch(pollUrl);

                if (!pollFetch.ok) throw new Error("A Pollinations tartalék sem érhető el.");

                const arrayBuf = await pollFetch.arrayBuffer();
                const audioBuffer = Buffer.from(arrayBuf);

                console.log(`🎧 Pollinations siker! Méret: ${audioBuffer.length} bájt`);

                res.setHeader("Content-Type", "audio/mpeg");
                res.setHeader("Content-Length", audioBuffer.length);
                return res.status(200).send(audioBuffer);

            } catch (fallbackError) {
                console.error("❌ Pollinations hiba:", fallbackError.message);
                return res.status(500).json({
                    success: false,
                    error: "A Hugging Face és a Pollinations tartalék is sikertelen volt."
                });
            }
        }

        console.log("✅ Generálás kész, válasz feldolgozása...");

        // 3. Ha a HF Space sikeres volt, kinyerjük az adatot
        let audioData = result?.data?.[0];

        if (!audioData) {
            return res.status(500).json({ 
                success: false, 
                error: "A Hugging Face Space lefutott, de nem küldött audio adatot." 
            });
        }

        if (typeof audioData === "string" && audioData.trim().startsWith("{")) {
            try {
                audioData = JSON.parse(audioData);
            } catch (e) {
                console.error("⚠️ Nem sikerült JSON-ként értelmezni az audioData-t:", e);
            }
        }

        if (typeof audioData === "object" && audioData !== null) {
            audioData = audioData.audio || audioData.url || audioData.path;
        }

        let audioBuffer;

        if (typeof audioData === "string" && audioData.startsWith("data:audio")) {
            const base64Data = audioData.split(",")[1];
            audioBuffer = Buffer.from(base64Data, "base64");
        } else if (typeof audioData === "string" && audioData.startsWith("http")) {
            const audioFetch = await fetch(audioData);
            const arrayBuf = await audioFetch.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuf);
        } else if (typeof audioData === "string" && audioData.length > 100) {
            audioBuffer = Buffer.from(audioData, "base64");
        } else {
            return res.status(500).json({ 
                success: false, 
                error: "Ismeretlen audio formátum érkezett." 
            });
        }

        console.log(`🎧 Visszaküldés a kliensnek! Méret: ${audioBuffer.length} bájt`);
        
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        return res.status(200).send(audioBuffer);

    } catch (error) {
        console.error("❌ SERVER EXCEPTION:", error);
        return res.status(500).json({ 
            success: false, 
            error: `Szerver hiba: ${error.message || "Ismeretlen hiba történt."}` 
        });
    }
});

// ==========================================
// 2. FALLBACK MUSICGEN GENERÁLÁS (HF Inference Router)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    const { prompt, hfToken, apiKey, duration} = req.body || {};
    const token = hfToken || apiKey || process.env.HF_TOKEN;

    if (!prompt) {
        return res.status(400).json({ success: false, error: "Hiányzó prompt." });
    }
 // Kliens által küldött hossz feldolgozása (alapértelmezett: 10s)
    const audioDuration = Number(duration) || 10;

    console.log(`🎶 MusicGen generálás indítása: "${prompt}"...`);

    try {
        // 1. Csatlakozás a hivatalos MusicGen Gradio Space-hez
        const client = await Client.connect("facebook/MusicGen", {
            hf_token: token || undefined
        });

        // 2. Generálás futtatása egyetlen gyors próbálkozással
        let result;
        try {
            result = await client.predict(0, [prompt, null, audioDuration]);
        } catch (e) {
            console.warn("⚠️ MusicGen Space hívás sikertelen, azonnali átállás Pollinations-re...");
            throw e; // Átdobja a külső catch ágba, ami elindítja a Pollinations-t
        }

        const audioData = result?.data?.[0];
        if (!audioData) {
            throw new Error("Nem érkezett adatsor a MusicGen Space-ből.");
        }

        // 3. Audio URL vagy Base64 feldolgozása
        let audioBuffer;
        const audioUrl = typeof audioData === "object" ? (audioData.url || audioData.path) : audioData;

        if (typeof audioUrl === "string" && audioUrl.startsWith("http")) {
            const audioFetch = await fetch(audioUrl);
            const arrayBuf = await audioFetch.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuf);
        } else if (typeof audioData === "string" && audioData.startsWith("data:audio")) {
            const base64Data = audioData.split(",")[1];
            audioBuffer = Buffer.from(base64Data, "base64");
        } else {
            throw new Error("Ismeretlen válaszformátum érkezett a MusicGen-től.");
        }

        console.log(`🎧 MusicGen siker! Méret: ${audioBuffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        return res.status(200).send(audioBuffer);

    } catch (error) {
        console.error("⚠️ MusicGen Gradio hiba:", error.message);
        console.log("🔄 Átállás Pollinations AI ingyenes audió tartalékra...");

        // 4. Fallback: Ha a HF Space leterhelt/hibás, a Pollinations AI generálja le a zenét
        try {
            const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=audio&seed=${Math.floor(Math.random() * 1000)}`;
            const pollFetch = await fetch(pollUrl);
            
            if (!pollFetch.ok) throw new Error("A Pollinations tartalék sem érhető el.");

            const arrayBuf = await pollFetch.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuf);

            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Content-Length", audioBuffer.length);
            return res.status(200).send(audioBuffer);

        } catch (fallbackError) {
            return res.status(500).json({ 
                success: false, 
                error: `MusicGen és tartalék hiba: ${error.message}` 
            });
        }
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
