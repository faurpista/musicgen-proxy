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
// 3. ACE-STEP 1.5 TESZT
// ==========================================
app.post("/api/test-ace", async (req, res) => {
    console.log("==========================================");
    console.log("🎵 ACE-STEP 1.5 TESZT INDUL");
    console.log("==========================================");

    try {
        const prompt =
            req.body?.prompt ||
            "short cinematic electronic music, atmospheric, energetic";

        // A nyilvános Hugging Face Space
        const ACE_STEP_URL = "https://ace-step-v1-5.hf.space";

        console.log("🎼 Prompt:", prompt);
        console.log("🌐 ACE-Step:", ACE_STEP_URL);

        // ------------------------------------------
        // 1. GENERÁLÁSI FELADAT ELINDÍTÁSA
        // ------------------------------------------

        console.log("➡️ POST /v1/music/generate");

        const generateResponse = await fetch(
            `${ACE_STEP_URL}/v1/music/generate`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    caption: prompt,
                    audio_duration: 10,
                    audio_format: "mp3",
                    thinking: false
                })
            }
        );

        const generateText = await generateResponse.text();

        console.log(
            "📥 ACE-Step válasz:",
            generateResponse.status
        );

        console.log(generateText);

        if (!generateResponse.ok) {
            return res.status(generateResponse.status).json({
                success: false,
                step: "generate",
                status: generateResponse.status,
                error: generateText
            });
        }

        let generateData;

        try {
            generateData = JSON.parse(generateText);
        } catch (err) {
            return res.status(500).json({
                success: false,
                step: "generate",
                error: "Az ACE-Step nem JSON választ adott.",
                raw: generateText
            });
        }

        const jobId = generateData.job_id;

        if (!jobId) {
            return res.status(500).json({
                success: false,
                step: "generate",
                error: "Nem kaptunk job_id-t.",
                response: generateData
            });
        }

        console.log("🆔 JOB ID:", jobId);

        // ------------------------------------------
        // 2. JOB ÁLLAPOT LEKÉRDEZÉSE
        // ------------------------------------------

        let finalJob = null;

        const maxAttempts = 60;
        const waitMs = 2000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {

            await new Promise(resolve =>
                setTimeout(resolve, waitMs)
            );

            console.log(
                `🔄 Job ellenőrzés: ${attempt}/${maxAttempts}`
            );

            const jobResponse = await fetch(
                `${ACE_STEP_URL}/v1/jobs/${encodeURIComponent(jobId)}`
            );

            const jobText = await jobResponse.text();

            console.log(
                "📥 Job válasz:",
                jobResponse.status,
                jobText
            );

            if (!jobResponse.ok) {
                console.error(
                    "❌ Job lekérdezési hiba:",
                    jobText
                );
                continue;
            }

            let jobData;

            try {
                jobData = JSON.parse(jobText);
            } catch (err) {
                console.error(
                    "❌ Job válasza nem JSON:",
                    jobText
                );
                continue;
            }

            console.log(
                "📊 Állapot:",
                jobData.status
            );

            // --------------------------------------
            // SIKER
            // --------------------------------------

            if (jobData.status === "succeeded") {
                finalJob = jobData;
                break;
            }

            // --------------------------------------
            // HIBA
            // --------------------------------------

            if (jobData.status === "failed") {
                console.error(
                    "❌ ACE-Step generálási hiba:",
                    jobData
                );

                return res.status(500).json({
                    success: false,
                    step: "generation",
                    jobId,
                    error: jobData.error || "ACE-Step hiba",
                    response: jobData
                });
            }

            // queued / running
            console.log(
                `⏳ ACE-Step állapot: ${jobData.status}`
            );
        }

        // ------------------------------------------
        // 3. IDŐTÚLLÉPÉS
        // ------------------------------------------

        if (!finalJob) {
            return res.status(504).json({
                success: false,
                step: "polling",
                jobId,
                error:
                    "Az ACE-Step nem készült el a tesztidő alatt."
            });
        }

        console.log("==========================================");
        console.log("🎉 ACE-STEP SIKERES");
        console.log("==========================================");

        console.log(
            "📦 Teljes eredmény:",
            JSON.stringify(finalJob, null, 2)
        );

        // ------------------------------------------
        // 4. AUDIO PATH MEGKERESÉSE
        // ------------------------------------------

        const result = finalJob.result || {};

        const audioPath =
            result.first_audio_path ||
            result.audio_paths?.[0];

        console.log("🎵 Audio path:", audioPath);

        if (!audioPath) {
            return res.status(500).json({
                success: false,
                step: "audio-path",
                jobId,
                error:
                    "A generálás sikerült, de nem kaptunk audio path-ot.",
                result
            });
        }

        // ------------------------------------------
        // 5. MP3 LETÖLTÉSE AZ ACE-STEPTŐL
        // ------------------------------------------

        console.log("⬇️ MP3 letöltése...");

        const audioResponse = await fetch(
            `${ACE_STEP_URL}/v1/audio?path=${encodeURIComponent(audioPath)}`
        );

        console.log(
            "📥 Audio response:",
            audioResponse.status,
            audioResponse.headers.get("content-type")
        );

        if (!audioResponse.ok) {
            const audioError =
                await audioResponse.text();

            return res.status(audioResponse.status).json({
                success: false,
                step: "audio-download",
                jobId,
                error: audioError
            });
        }

        const audioBuffer = Buffer.from(
            await audioResponse.arrayBuffer()
        );

        console.log(
            `🎧 MP3 méret: ${audioBuffer.length} bájt`
        );

        // ------------------------------------------
        // 6. MP3 VISSZAKÜLDÉSE
        // ------------------------------------------

        res.setHeader(
            "Content-Type",
            "audio/mpeg"
        );

        res.setHeader(
            "Content-Length",
            audioBuffer.length
        );

        res.setHeader(
            "Content-Disposition",
            'inline; filename="ace-step-test.mp3"'
        );

        console.log("✅ MP3 visszaküldése a kliensnek.");

        res.send(audioBuffer);

    } catch (err) {

        console.error(
            "❌ ACE-STEP TESZT SERVER EXCEPTION:",
            err
        );

        res.status(500).json({
            success: false,
            step: "server",
            error: err.message
        });
    }
});

// ==========================================
// TESZT 1 - HUGGING FACE MUSICGEN
// ==========================================
app.post("/api/test-musicgen", async (req, res) => {
    console.log("=== TESZT 1: MUSICGEN ===");

    try {
        const { prompt, hfToken } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Hiányzó prompt"
            });
        }

        const token = hfToken || process.env.HF_TOKEN;

        if (!token) {
            return res.status(400).json({
                error: "Hiányzó HF_TOKEN"
            });
        }

        const MODEL = "facebook/musicgen-small";

        // A jelenlegi HF router
        const url =
            `https://router.huggingface.co/hf-inference/models/${MODEL}`;

        console.log("➡️ URL:", url);
        console.log("🎵 Prompt:", prompt);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: prompt
            })
        });

        const contentType =
            response.headers.get("content-type") || "";

        console.log("⬅️ Status:", response.status);
        console.log("⬅️ Content-Type:", contentType);

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "❌ MusicGen HF hiba:",
                errorText
            );

            return res.status(response.status).json({
                success: false,
                test: "musicgen",
                status: response.status,
                error: errorText
            });
        }

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        console.log(
            `✅ MusicGen válasz: ${buffer.length} byte`
        );

        res.setHeader(
            "Content-Type",
            contentType || "audio/wav"
        );

        res.setHeader(
            "Content-Length",
            buffer.length
        );

        res.send(buffer);

    } catch (err) {
        console.error(
            "❌ MusicGen exception:",
            err
        );

        res.status(500).json({
            success: false,
            test: "musicgen",
            error: err.message
        });
    }
});

// ==========================================
// TESZT 2 - STABLE AUDIO OPEN
// ==========================================
app.post("/api/test-stable-audio", async (req, res) => {
    console.log("=== TESZT 2: STABLE AUDIO OPEN ===");

    try {
        const { prompt, hfToken } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Hiányzó prompt"
            });
        }

        const token = hfToken || process.env.HF_TOKEN;

        if (!token) {
            return res.status(400).json({
                error: "Hiányzó HF_TOKEN"
            });
        }

        const MODEL =
            "stabilityai/stable-audio-open-1.0";

        const url =
            `https://router.huggingface.co/hf-inference/models/${MODEL}`;

        console.log("➡️ URL:", url);
        console.log("🎵 Prompt:", prompt);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: prompt
            })
        });

        const contentType =
            response.headers.get("content-type") || "";

        console.log("⬅️ Status:", response.status);
        console.log("⬅️ Content-Type:", contentType);

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "❌ Stable Audio HF hiba:",
                errorText
            );

            return res.status(response.status).json({
                success: false,
                test: "stable-audio",
                status: response.status,
                error: errorText
            });
        }

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        console.log(
            `✅ Stable Audio válasz: ${buffer.length} byte`
        );

        res.setHeader(
            "Content-Type",
            contentType || "audio/wav"
        );

        res.setHeader(
            "Content-Length",
            buffer.length
        );

        res.send(buffer);

    } catch (err) {
        console.error(
            "❌ Stable Audio exception:",
            err
        );

        res.status(500).json({
            success: false,
            test: "stable-audio",
            error: err.message
        });
    }
});


app.post("/api/generate-free-audio", async (req, res) => {
    console.log("=== ACE-STEP FREE AUDIO ===");

    try {
        const {
            prompt,
            hfToken: tokenFromClient,
            apiKey
        } = req.body || {};

        const hfToken =
            tokenFromClient || apiKey;

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

        console.log("🎵 Prompt:", prompt);
        console.log("🔐 HF token: BEÉRKEZETT");

        const SPACE =
            "https://victor-ace-step-jam.hf.space";

        const response = await fetch(
            `${SPACE}/gradio_api/call/create`,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${hfToken}`,
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    data: [
                        prompt,
                        10,
                        -1,
                        false
                    ]
                })
            }
        );

        const text =
            await response.text();

        console.log(
            "HF STATUS:",
            response.status
        );

        console.log(
            "HF RESPONSE:",
            text.substring(0, 1000)
        );

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                step: "create",
                status: response.status,
                error: text
            });
        }

        const data =
            JSON.parse(text);

        if (!data.event_id) {
            return res.status(500).json({
                success: false,
                error: "Nincs event_id.",
                response: data
            });
        }

        const eventId =
            data.event_id;

        console.log(
            "🆔 Event ID:",
            eventId
        );

        // SSE eredmény
        const resultResponse =
            await fetch(
                `${SPACE}/gradio_api/call/create/${eventId}`,
                {
                    headers: {
                        "Authorization":
                            `Bearer ${hfToken}`,
                        "Accept":
                            "text/event-stream"
                    }
                }
            );

        const resultText =
            await resultResponse.text();

        console.log(
            "RESULT STATUS:",
            resultResponse.status
        );

        console.log(
            "RESULT:",
            resultText.substring(0, 2000)
        );

        if (!resultResponse.ok) {
            return res.status(
                resultResponse.status
            ).json({
                success: false,
                step: "result",
                error: resultText
            });
        }

        // Megkeressük a complete eseményt
        const blocks =
            resultText
                .split("\n\n")
                .filter(Boolean);

        let result = null;

        for (const block of blocks) {

            if (!block.includes("event: complete")) {
                continue;
            }

            const dataLine =
                block
                    .split("\n")
                    .find(line =>
                        line.startsWith("data:")
                    );

            if (!dataLine) continue;

            const jsonText =
                dataLine
                    .substring(5)
                    .trim();

            result =
                JSON.parse(jsonText);

            break;
        }

        if (!result) {
            return res.status(500).json({
                success: false,
                error:
                    "Nem érkezett complete esemény.",
                raw:
                    resultText.substring(
                        0,
                        3000
                    )
            });
        }

        console.log("✅ Generálás kész.");

        // A Space válaszának feldolgozása
        let output = result;

        if (Array.isArray(output)) {
            output = output[0];
        }

        if (typeof output === "string") {
            try {
                output =
                    JSON.parse(output);
            } catch {}
        }

        console.log(
            "OUTPUT:",
            output
        );

        if (!output?.audio) {
            return res.status(500).json({
                success: false,
                error:
                    "Nem található audio az eredményben.",
                output
            });
        }

        const audioData =
            output.audio;

        const comma =
            audioData.indexOf(",");

        if (comma === -1) {
            return res.status(500).json({
                success: false,
                error:
                    "Hibás audio data URL."
            });
        }

        const base64 =
            audioData.substring(
                comma + 1
            );

        const buffer =
            Buffer.from(
                base64,
                "base64"
            );

        console.log(
            "🎧 Audio:",
            buffer.length,
            "byte"
        );

        res.setHeader(
            "Content-Type",
            "audio/wav"
        );

        res.send(buffer);

    } catch (error) {

        console.error(
            "❌ ACE-STEP ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});                                     

    

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
