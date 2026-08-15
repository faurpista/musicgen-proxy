const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================
// 1. ZENE GENERÁLÁS (Hugging Face Inference API)
// ==========================================
app.post("/api/generate-audio", async (req, res) => {
    console.log("=== GENERATE AUDIO HÍVÁS (Hugging Face) ===");

    try {
        const { prompt, apiKey, hfToken: tokenFromClient } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt!" });
        }

        const hfToken = tokenFromClient || apiKey || process.env.HF_TOKEN;
        if (!hfToken) {
            return res.status(400).json({ error: "Hiányzó Hugging Face API kulcs!" });
        }

        console.log(`🎶 Zene generálása a Hugging Face-en: "${prompt}"...`);

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
// 2. ACE-STEP FREE AUDIO GENERATION (Gradio API Stream Olvasóval)
// ==========================================
app.post("/api/generate-free-audio", async (req, res) => {
    console.log("=== ACE-STEP FREE AUDIO GENERÁLÁS ===");

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

        const audioDuration = parseInt(duration) || 10;

        let finalPrompt = prompt;
        if (lyrics && typeof lyrics === "string" && lyrics.trim() !== "") {
            finalPrompt = `${prompt}\n\n${lyrics.trim()}`;
        }

        console.log(`🎵 Prompt: "${finalPrompt}"`);
        console.log(`⏱️ Időtartam: ${audioDuration} mp`);

        const SPACE = "https://victor-ace-step-jam.hf.space";

        // 1. Feladat indítása
        const response = await fetch(`${SPACE}/gradio_api/call/create`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${hfToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                data: [
                    finalPrompt,   
                    audioDuration, 
                    -1,            
                    false          
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Space indítási hiba:", response.status, errorText);
            return res.status(response.status).json({
                success: false,
                step: "create",
                error: `Space Hiba (${response.status}). Lehet, hogy épp indul a szerver.`
            });
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("❌ Nem JSON válasz érkezett:", responseText.substring(0, 200));
            return res.status(503).json({
                success: false,
                error: "A zenerendszer éppen indul vagy túlterhelt. Próbáld újra 1 perc múlva!"
            });
        }

        const eventId = data.event_id;
        if (!eventId) {
            return res.status(500).json({
                success: false,
                error: "Nem érkezett event_id a Gradio API-tól."
            });
        }

        console.log("🆔 Event ID megérkezett:", eventId);

        // 2. Eredmény megvárása Stream olvasóval
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

        // --- ÉLŐ STREAM OLVASÓ (Azonnal kilép a complete eseménynél) ---
        const reader = resultResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let bufferStr = "";
        let result = null;
        let gradioError = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bufferStr += decoder.decode(value, { stream: true });

            if (bufferStr.includes("event: error")) {
                gradioError = bufferStr;
                reader.cancel();
                break;
            }

            if (bufferStr.includes("event: complete")) {
                const blocks = bufferStr.split("\n\n");
                for (const block of blocks) {
                    if (block.includes("event: complete")) {
                        const dataLine = block.split("\n").find(line => line.startsWith("data:"));
                        if (dataLine) {
                            try {
                                result = JSON.parse(dataLine.substring(5).trim());
                            } catch (e) {
                                console.error("❌ SSE JSON Parse hiba:", e);
                            }
                        }
                    }
                }

                if (result) {
                    console.log("⚡ Complete esemény észlelve, stream lezárva!");
                    reader.cancel();
                    break;
                }
            }
        }

        if (gradioError) {
            console.error("❌ Gradio hiba érkezett:", gradioError);
            return res.status(500).json({
                success: false,
                error: "A Hugging Face Space hibát küldött a generálás alatt."
            });
        }

        if (!result) {
            return res.status(500).json({
                success: false,
                error: "Nem érkezett complete esemény a megadott időn belül."
            });
        }

        // 3. Audio átalakítása és visszaküldése
        let output = Array.isArray(result) ? result[0] : result;
        if (typeof output === "string") {
            try { output = JSON.parse(output); } catch {}
        }

        if (!output?.audio) {
            return res.status(500).json({
                success: false,
                error: "Nem található audio adat a generálás kimenetében.",
                output
            });
        }

        const commaIndex = output.audio.indexOf(",");
        if (commaIndex === -1) {
            return res.status(500).json({ success: false, error: "Hibás Audio Data URL formátum." });
        }

        const base64Data = output.audio.substring(commaIndex + 1);
        const audioBuffer = Buffer.from(base64Data, "base64");

        console.log(`✅ Sikeres generálás! Audio méret: ${audioBuffer.length} bájt`);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        res.send(audioBuffer);

    } catch (error) {
        console.error("❌ ACE-STEP SERVER EXCEPTION:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 3. SZÖVEG / DALSZÖVEG GENERÁLÁS (Hugging Face LLM)
// ==========================================
app.post("/api/generate-text", async (req, res) => {
    console.log("=== DALSZÖVEG GENERÁLÁS (Hugging Face LLM) ===");

    try {
        const { prompt, hfToken: tokenFromClient, apiKey } = req.body;

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
