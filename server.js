const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Client } = require("@gradio/client");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));


// ==========================================
// 1. FALLBACK MUSICGEN GENERÁLÁS (HF Inference Router)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    console.log("=== GENERATE AUDIO HÍVÁS (MusicGen) ===");

    try {
        const { prompt, apiKey } = req.body || {};
        const hfToken = apiKey || process.env.HF_TOKEN;

        if (!hfToken) {
            return res.status(401).json({ success: false, error: "Hiányzó Hugging Face API token." });
        }

        if (!prompt) {
            return res.status(400).json({ success: false, error: "Hiányzó prompt." });
        }

        console.log(`🎶 Zene generálása: "${prompt}"...`);

        // Az új, hivatalos HF Router URL a régi api-inference helyett
        const MUSICGEN_URL = "https://router.huggingface.co/hf-inference/models/facebook/musicgen-small";

        const response = await fetch(MUSICGEN_URL, {
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            method: "POST",
            body: JSON.stringify({ inputs: prompt }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ MusicGen hiba válasz:", errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: `MusicGen hiba (${response.status}): ${errorText}` 
            });
        }

        const audioArrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);

        console.log(`🎧 MusicGen sikeres! Méret: ${audioBuffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        res.send(audioBuffer);

    } catch (error) {
        console.error("❌ SERVER EXCEPTION:", error);
        res.status(500).json({ 
            success: false, 
            error: `Szerver hiba: ${error.message}` 
        });
    }
});

// ==========================================
// 2. ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client)
// ≈=====≈===================================
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
//console.log("🔍 audioData nyers tartalma:", JSON.stringify(audioData, null, 2));

if (!audioData) {
    return res.status(500).json({ 
        success: false, 
        error: "A Hugging Face Space lefutott, de nem küldött audio adatot." 
    });
}

// 1. Ha az audioData egy JSON karakterlánc (pl. '{"audio": "data:audio/wav..."}')
if (typeof audioData === "string" && audioData.trim().startsWith("{")) {
    try {
        audioData = JSON.parse(audioData);
    } catch (e) {
        console.error("⚠️ Nem sikerült JSON-ként értelmezni az audioData-t:", e);
    }
}

// 2. Ha objektumról van szó, kinyerjük az audio / url / path mezőt
if (typeof audioData === "object" && audioData !== null) {
    audioData = audioData.audio || audioData.url || audioData.path;
}

let audioBuffer;

try {
    // A) Base64 Data URL (pl. "data:audio/wav;base64,...")
    if (typeof audioData === "string" && audioData.startsWith("data:audio")) {
        const base64Data = audioData.split(",")[1];
        audioBuffer = Buffer.from(base64Data, "base64");
    } 
    // B) HTTP URL
    else if (typeof audioData === "string" && audioData.startsWith("http")) {
        const audioFetch = await fetch(audioData);
        const arrayBuf = await audioFetch.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuf);
    } 
    // C) Tiszta Base64 string
    else if (typeof audioData === "string" && audioData.length > 100) {
        audioBuffer = Buffer.from(audioData, "base64");
    } 
    else {
        console.error("❌ Ismeretlen audioData struktúra:", audioData);
        return res.status(500).json({ 
            success: false, 
            error: "Ismeretlen audio formátum érkezett." 
        });
    }

        console.log(`🎧 Visszaküldés a kliensnek! Méret: ${audioBuffer.length} bájt`);
// Beállítjuk a válasz fejléceket, hogy a böngésző audióként értelmezze
    res.setHeader("Content-Type", "audio/wav"); // Ha MP3 érkezik, írd át 'audio/mpeg'-re
    res.setHeader("Content-Length", audioBuffer.length);

    // Nyers binary puffer visszaküldése a kliensnek
    return res.status(200).send(audioBuffer);


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
