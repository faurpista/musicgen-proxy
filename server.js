const dns = require('dns');
// Globális IPv4 előnyben részesítés – megszünteti a 'fetch failed' hibát 
// anélkül, hogy ENOTFOUND DNS-hibát okozna a Render konténerekben.
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const express = require("express");
const cors = require("cors");
const { Client } = require("@gradio/client");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Segédfunkció: Intelligen9s argumentumszámlálóval ellátott MusicGen tartalék
// Segédfunkció: HF Serverless Inference API + Biztonsági Gradio tartalék
const https = require('https');

// Végleges tartalék funkció: Gradio REST API api_name/fn_index azonosítással
// Végleges tartalék funkció: Univerzális SSE/Queue elemzővel ellátott MusicGen
// Végleges javítás: Valódi SSE Stream várakozással (getReader)
async function fetchFallbackAudio(prompt, duration, token) {
    const audioDuration = Math.min(Math.floor(Number(duration) || 5), 10);
    console.log(`⏳ Átállás MusicGen tartalék motorokra...`);

    // 1. STRATÉGIA: HF Inference API
    if (token) {
        try {
            console.log(`🎵 Próbálkozás HF Inference API-val...`);
            const hfRes = await fetch("https://api-inference.huggingface.co/models/facebook/musicgen-small", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token.trim()}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ inputs: prompt })
            });

            if (hfRes.ok) {
                const buffer = Buffer.from(await hfRes.arrayBuffer());
                if (buffer.length > 2000) {
                    console.log(`✅ Sikeres HF Inference API generálás! (${buffer.length} bájt)`);
                    return buffer;
                }
            }
        } catch (hfErr) {
            console.warn(`⚠️ HF Inference API hiba:`, hfErr.message);
        }
    }

    // 2. STRATÉGIA: Aktív Gradio Space-ek
    const hosts = [
        "facebook-musicgen.hf.space",
        "suno-bark.hf.space" // Működő alternatív hang/zene Space
    ];

    for (const host of hosts) {
        const sessionHash = Math.random().toString(36).substring(2, 13);
        const payload = {
            data: ["musicgen-small", prompt, null, audioDuration, 250, 0, 1.0, 3.0],
            event_data: null,
            fn_index: 0,
            session_hash: sessionHash
        };

        try {
            console.log(`🎵 Csatlakozás a várakozási sorhoz [${host}]...`);
            const joinRes = await fetch(`https://${host}/gradio_api/queue/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!joinRes.ok) continue;

            console.log(`⏳ Várakozás a generálás befejezésére [${host}]...`);
            const streamRes = await fetch(`https://${host}/gradio_api/queue/data?session_hash=${sessionHash}`);
            if (!streamRes.ok || !streamRes.body) continue;

            // 🔴 A LÉNYEG: Megvárjuk a stream végét, amíg megérkezik a fájl URL
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let streamBuffer = "";
            let fileUrl = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                streamBuffer += decoder.decode(value, { stream: true });

                // Amikor megérkezik a process_completed esemény
                if (streamBuffer.includes("process_completed")) {
                    const lines = streamBuffer.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data:")) {
                            try {
                                const parsed = JSON.parse(line.slice(5).trim());
                                const dataArray = parsed.output?.data || parsed.data;
                                if (Array.isArray(dataArray) && dataArray[0]) {
                                    const item = dataArray[0];
                                    fileUrl = typeof item === "object" ? (item.url || item.path || item.name) : item;
                                    if (fileUrl) break;
                                }
                            } catch (e) {}
                        }
                    }
                    if (fileUrl) break;
                }
            }

            if (!fileUrl) continue;

            let downloadUrl = fileUrl.startsWith("http") 
                ? fileUrl 
                : `https://${host}/gradio_api/file=${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;

            console.log(`🎧 Letöltés [${host}]: ${downloadUrl}`);
            const audioRes = await fetch(downloadUrl);
            if (audioRes.ok) {
                const buffer = Buffer.from(await audioRes.arrayBuffer());
                if (buffer.length > 2000) {
                    console.log(`✅ Sikeres generálás! (${buffer.length} bájt)`);
                    return buffer;
                }
            }

        } catch (err) {
            console.warn(`⚠️ Hiba [${host}]:`, err.message);
        }
    }

    throw new Error("Egyetlen tartalék API sem tudott hangfájlt előállítani.");
}
      
// ==========================================
// 1. ACE-STEP FREE AUDIO GENERÁLÁS (@gradio/client)
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

        let audioBuffer;

        // 1. Megpróbáljuk az ACE-Step Space-t
        try {
            const client = await Client.connect("victor/ace-step-jam", {
                hf_token: hfToken
            });

            const apiPayload = [
                finalPrompt,        // 0: Prompt + Dalszöveg
                audioDuration,      // 1: Hossz másodpercben
                -1,                 // 2: Seed
                false               // 3: Thinking
            ];

            const result = await client.predict(0, apiPayload);
            let audioData = result?.data?.[0];

            if (!audioData) {
                throw new Error("Nem érkezett audio adat a Space-ből.");
            }

            if (typeof audioData === "string" && audioData.trim().startsWith("{")) {
                try { audioData = JSON.parse(audioData); } catch (e) {}
            }

            if (typeof audioData === "object" && audioData !== null) {
                audioData = audioData.audio || audioData.url || audioData.path;
            }

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
                throw new Error("Ismeretlen audio formátum érkezett.");
            }

            console.log(`🎧 ACE-Step siker! Méret: ${audioBuffer.length} bájt`);

        } catch (err) {
            console.warn("⚠️ HF Space / ZeroGPU hiba, átállás MusicGen tartalékra:", err.message);

            // Tartalék: facebook/MusicGen Space (nem ZeroGPU)
            try {
                audioBuffer = await fetchFallbackAudio(finalPrompt, audioDuration, hfToken);
                console.log(`🎧 MusicGen tartalék siker! Méret: ${audioBuffer.length} bájt`);
            } catch (fallbackError) {
                console.error("❌ Tartalék API hiba:", fallbackError.message);
                return res.status(500).json({
                    success: false,
                    error: `A ZeroGPU és a tartalék MusicGen Space is sikertelen volt: ${fallbackError.message}`
                });
            }
        }

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
// 2. FALLBACK MUSICGEN GENERÁLÁS (Gradio / Inference API)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    console.log("=== MUSICGEN AUDIO GENERÁLÁS ===");

    try {
        const { prompt, hfToken, apiKey, duration } = req.body || {};
        const token = hfToken || apiKey || process.env.HF_TOKEN;

        if (!token) {
            return res.status(401).json({ success: false, error: "Hiányzó Hugging Face API token." });
        }

        if (!prompt) {
            return res.status(400).json({ success: false, error: "Hiányzó prompt." });
        }

        const audioDuration = Number(duration) || 10;
        console.log(`🎶 MusicGen generálás indítása: "${prompt}" (${audioDuration}s)...`);

        let audioBuffer;

        // 1. Csatlakozás a MusicGen Gradio Space-hez
        try {
            const client = await Client.connect("facebook/MusicGen", {
                hf_token: token
            });

            const result = await client.predict(0, [prompt, null, audioDuration]);
            const audioData = result?.data?.[0];

            if (!audioData) {
                throw new Error("Nem érkezett adatsor a MusicGen Space-ből.");
            }

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

            console.log(`🎧 MusicGen Space siker! Méret: ${audioBuffer.length} bájt`);

        } catch (error) {
            console.warn("⚠️ MusicGen Space hiba, átállás HF Serverless tartalékra:", error.message);

            // 2. Tartalék: HF Direct Inference
            try {
                audioBuffer = await fetchHfInferenceAudio(prompt, token);
                console.log(`🎧 HF Serverless tartalék siker! Méret: ${audioBuffer.length} bájt`);
            } catch (fallbackError) {
                return res.status(500).json({ 
                    success: false, 
                    error: `MusicGen Space és a tartalék API is leállt: ${fallbackError.message}` 
                });
            }
        }

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
            return res.status(401).json({ error: "Hiányzó Hugging Face API kulcs!" });
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
            
