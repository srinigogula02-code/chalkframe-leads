import fs from "fs";

async function findImageModels() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const data = await res.json();
  const models = data.data || [];

  console.log("Searching for models with image output on OpenRouter:");
  for (const m of models) {
    const outputs = m.architecture?.output_modalities || [];
    if (outputs.includes("image")) {
      console.log(`- ${m.id} (${m.name})`);
    }
  }
}

findImageModels().catch(console.error);
