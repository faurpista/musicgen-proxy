const express = require("express");
const cors = require("cors");
const { Client } = require("@gradio/client");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.post("/api/generate-audio", async (req, res) => {
    try {
        const { prompt, hfToken } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Hiányzó prompt" });
        }

        console.log("🎶 Zene generálása a HF Space-en keresztül...");

        // Csatlakozás a hivatalos facebook/MusicGen Gradio Space-hez
        // (A hfToken megadása opció, de segít elkerülni a sűrűség miatti korlátokat)
        const client = await Client.connect("facebook/MusicGen", {
            hf_token: hfToken || undefined
        });

        // Modell paramétereinek elküldése
        const result = await client.predict("/predict", {
            model: "facebook/musicgen-small",
            text: prompt,
            audio: null,        // Nincs referencia audió (text-to-music)
            duration: 10,       // Hossz másodpercben (pl. 10 mp)
            top_k: 250,
            top_p: 0,
            temperature: 1,
            cfg_coef: 3
        });

        // A Gradio az generált fáljt egy URL formájában adja vissza (result.data[0])
        const audioData = result.data[0];
        const audioUrl = audioData.url;

        // Audió fájl letöltése és továbbítása a frontend felé
        const audioResponse = await fetch(audioUrl);
        const buffer = Buffer.from(await audioResponse.arrayBuffer());

        res.setHeader("Content-Type", "audio/wav");
        res.send(buffer);

    } catch (err) {
        console.error("MUSICGEN ERROR:", err);
        res.status(500).json({
            error: `Zenegenerálási hiba: ${err.message}`
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
