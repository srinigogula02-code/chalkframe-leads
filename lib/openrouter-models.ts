import "server-only";

export type OpenRouterModelOption = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number | null;
  completionPrice: number | null;
  imagePrice: number | null;
  expirationDate: string | null;
  isVision: boolean;
  isImageGeneration: boolean;
};

type ModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    context_length?: number;
    expiration_date?: string | null;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    pricing?: { prompt?: string; completion?: string; image?: string };
  }>;
};

type DedicatedImageModelsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  }>;
};

function price(value: string | undefined) {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function getOpenRouterModels(): Promise<OpenRouterModelOption[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as ModelResponse;
    const now = Date.now();
    return (body.data ?? [])
      .filter(model => model.id && (!model.expiration_date || Date.parse(model.expiration_date) > now))
      .map(model => {
        const id = String(model.id || "");
        const name = String(model.name || id);
        const inputs = model.architecture?.input_modalities || [];
        const outputs = model.architecture?.output_modalities || [];

        const isImageGeneration = Boolean(
          outputs.includes("image") ||
          /flux|recraft|sdxl|stable-diffusion|dall-e|imagen|midjourney|ideogram|playground|image-2|image-preview|-image/i.test(id || name)
        );

        const isVision = Boolean(
          inputs.includes("image") ||
          outputs.includes("image") ||
          /vision|gpt-4o|gemini|claude-3|qwen-vl|pixtral|llava|cogvlm|multimodal/i.test(id || name)
        );

        return {
          id,
          name,
          contextLength: Number(model.context_length || 0),
          promptPrice: price(model.pricing?.prompt),
          completionPrice: price(model.pricing?.completion),
          imagePrice: price(model.pricing?.image),
          expirationDate: model.expiration_date || null,
          isVision,
          isImageGeneration,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getVisionModels(): Promise<OpenRouterModelOption[]> {
  const all = await getOpenRouterModels();
  return all.filter(m => m.isVision);
}

export async function getImageGenerationModels(): Promise<OpenRouterModelOption[]> {
  const [all, dedicatedRes] = await Promise.all([
    getOpenRouterModels(),
    fetch("https://openrouter.ai/api/v1/images/models", {
      headers: { accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null),
  ]);

  const map = new Map<string, OpenRouterModelOption>();

  // Add image models from general /api/v1/models endpoint
  all.filter(m => m.isImageGeneration).forEach(m => map.set(m.id, m));

  // Add models from official /api/v1/images/models endpoint
  if (dedicatedRes && dedicatedRes.ok) {
    try {
      const dedicatedBody = (await dedicatedRes.json()) as DedicatedImageModelsResponse;
      if (Array.isArray(dedicatedBody.data)) {
        for (const item of dedicatedBody.data) {
          if (item.id && !map.has(item.id)) {
            map.set(item.id, {
              id: item.id,
              name: item.name || item.id,
              contextLength: 4096,
              promptPrice: 0.04,
              completionPrice: 0.04,
              imagePrice: 0.04,
              expirationDate: null,
              isVision: true,
              isImageGeneration: true,
            });
          }
        }
      }
    } catch (e) {
      console.warn("Could not parse /api/v1/images/models:", e);
    }
  }

  // Curated defaults fallback list
  const curatedImageGenList: Array<{ id: string; name: string }> = [
    { id: "google/gemini-2.5-flash-image", name: "Google: Gemini 2.5 Flash Image" },
    { id: "google/gemini-3.1-flash-image", name: "Google: Gemini 3.1 Flash Image" },
    { id: "google/gemini-3-pro-image", name: "Google: Gemini 3 Pro Image" },
    { id: "openai/gpt-5-image", name: "OpenAI: GPT-5 Image" },
    { id: "openai/gpt-image-2", name: "OpenAI: GPT Image 2" },
    { id: "openai/dall-e-3", name: "OpenAI: DALL-E 3" },
    { id: "black-forest-labs/flux-1-schnell", name: "Flux 1 Schnell (Black Forest Labs)" },
    { id: "recraft-ai/recraft-20b", name: "ReCraft 20B Vector & Raster" },
    { id: "bytedance-seed/seedream-4.5", name: "ByteDance: Seedream 4.5" },
  ];

  curatedImageGenList.forEach(p => {
    if (!map.has(p.id)) {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        contextLength: 4096,
        promptPrice: 0.04,
        completionPrice: 0.04,
        imagePrice: 0.04,
        expirationDate: null,
        isVision: true,
        isImageGeneration: true,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOpenRouterCredits() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { configured: false, totalCredits: null, totalUsage: null, error: null };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { configured: true, totalCredits: null, totalUsage: null, error: `OpenRouter returned ${response.status}` };
    const payload = (await response.json()) as { data?: { total_credits?: number; total_usage?: number } };
    return {
      configured: true,
      totalCredits: Number.isFinite(payload.data?.total_credits) ? Number(payload.data?.total_credits) : null,
      totalUsage: Number.isFinite(payload.data?.total_usage) ? Number(payload.data?.total_usage) : null,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      totalCredits: null,
      totalUsage: null,
      error: error instanceof Error ? error.message : "Could not load OpenRouter credits",
    };
  }
}
