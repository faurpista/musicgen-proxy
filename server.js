const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({limit:"2mb"}));

app.post("/api/generate-audio", async (req,res)=>{

    try {

        const {prompt,hfToken}=req.body;

        if(!prompt || !hfToken){
            return res.status(400).json({
                error:"Hiányzó prompt vagy token"
            });
        }


        const hfResponse = await fetch(
  "https://router.huggingface.co/hf-inference/models/facebook/musicgen-small",
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${hfToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs: prompt
    })
  }
);


        if(!hfResponse.ok){

            const errorText=await hfResponse.text();

            console.log(
              "HF ERROR:",
              hfResponse.status,
              errorText
            );

            return res.status(hfResponse.status)
                .json({
                    error:errorText
                });
        }


        const buffer=Buffer.from(
            await hfResponse.arrayBuffer()
        );


        res.setHeader(
            "Content-Type",
            "audio/mpeg"
        );

        res.send(buffer);


    } catch(err){

        console.error(err);

        res.status(500).json({
            error:err.message
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
