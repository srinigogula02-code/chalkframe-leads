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
  supportsReferenceImages?: boolean;
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
    supported_parameters?: Record<string, { type?: string; values?: string[] }>;
  }>;
};

export type ImageGenerationCapabilities = {
  modelId: string;
  providerTag: string | null;
  aspectRatios: string[];
  supportsQuality: boolean;
  supportsOutputFormat: boolean;
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
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images/models", {
      headers: { accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as DedicatedImageModelsResponse;
    return (body.data ?? [])
      .filter(item => item.id)
      .filter(item => item.architecture?.input_modalities?.includes("image") && item.architecture?.output_modalities?.includes("image"))
      .filter(item => Boolean(item.supported_parameters?.input_references))
      .map(item => ({
        id: String(item.id),
        name: item.name || String(item.id),
        contextLength: 4096,
        promptPrice: null,
        completionPrice: null,
        imagePrice: null,
        expirationDate: null,
        isVision: true,
        isImageGeneration: true,
        supportsReferenceImages: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getImageGenerationCapabilities(modelId: string): Promise<ImageGenerationCapabilities | null> {
  const safeModelId = modelId.trim();
  if (!safeModelId) return null;
  const endpointPath = safeModelId.split("/").map(encodeURIComponent).join("/");
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/images/models/${endpointPath}/endpoints`, {
      headers: { accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      endpoints?: Array<{
        provider_tag?: string | null;
        supported_parameters?: Record<string, { type?: string; values?: string[] }>;
      }>;
    };
    const endpoint = body.endpoints?.find(item => Boolean(item.supported_parameters?.input_references));
    if (!endpoint) return null;
    const parameters = endpoint.supported_parameters || {};
    return {
      modelId: safeModelId,
      providerTag: endpoint.provider_tag || null,
      aspectRatios: parameters.aspect_ratio?.values || [],
      supportsQuality: Boolean(parameters.quality),
      supportsOutputFormat: Boolean(parameters.output_format),
    };
  } catch {
    return null;
  }
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
