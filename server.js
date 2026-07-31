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


app.listen(
    process.env.PORT || 3000,
    ()=>console.log("Music proxy running")
);
