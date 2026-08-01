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

        console.log("🎶 Csatlakozás a facebook/MusicGen Space-hez...");

        // Csatlakozás a Space-hez
        // ÚJ, stabilabb alternatív Space:
const client = await Client.connect("grandjourney/MusicGen", {
    hf_token: hfToken || undefined
});

        console.log("⏳ Zene generálása folyamatban...");

        // A predict hívása tömbös paraméter átadással
        // [model, text_prompt, audio_input, duration, top_k, top_p, temperature, classifier_free_guidance]
        const result = await client.predict(0, [
            "facebook/musicgen-small", // Modell típusa
            prompt,                     // Szöveges prompt
            null,                       // Melódia/audió bemenet (text-to-music esetén null)
            10,                         // Időtartam másodpercben (pl. 10 mp)
            250,                        // Top-k
            0,                          // Top-p
            1,                          // Temperature
            3                           // CFG scale
        ]);

        // A generált fájl adatait kiszedjük a válaszból
        const audioData = result.data[0];
        
        // A Gradio 1.x+ klienstől függően az URL lehet audioData.url vagy maga az audioData objektum
        const fileUrl = audioData?.url || audioData;

        if (!fileUrl) {
            throw new Error("Nem érkezett érvényes audio URL a Gradio Space-ből.");
        }

        console.log("📥 Audió letöltése innen:", fileUrl);

        // Fájl letöltése és továbbítása a kliensnek
        const audioResponse = await fetch(fileUrl);
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
