import fs from "fs";

const envFile = fs.readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim();
  }
}

const apiKey = process.env.OPENROUTER_API_KEY;

async function testModel(modelId) {
  console.log(`\nTesting OpenRouter model for image generation: ${modelId}`);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: "Create a modern, sleek Instagram ad creative for a premium notebook brand.",
          },
        ],
      }),
    });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Response choices:", JSON.stringify(data.choices || data.error || data, null, 2).slice(0, 500));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

async function main() {
  const candidateModels = [
    "black-forest-labs/flux-1-schnell",
    "recraft-ai/recraft-20b-svg",
    "google/gemini-2.5-flash-image",
    "bytedance/sdxl-lightning",
    "stabilityai/stable-diffusion-3.5-large",
    "openrouter/auto",
  ];

  for (const model of candidateModels) {
    await testModel(model);
  }
}

main().catch(console.error);
