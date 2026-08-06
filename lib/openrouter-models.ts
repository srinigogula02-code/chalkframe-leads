import "server-only";

export type OpenRouterModelOption = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number | null;
  completionPrice: number | null;
  imagePrice: number | null;
  expirationDate: string | null;
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

function price(value: string | undefined) {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function getVisionModels(): Promise<OpenRouterModelOption[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const body = await response.json() as ModelResponse;
    const now = Date.now();
    return (body.data ?? [])
      .filter(model => model.id && model.architecture?.input_modalities?.includes("image") && model.architecture?.output_modalities?.includes("text"))
      .filter(model => !model.expiration_date || Date.parse(model.expiration_date) > now)
      .map(model => ({
        id: String(model.id),
        name: model.name || String(model.id),
        contextLength: Number(model.context_length || 0),
        promptPrice: price(model.pricing?.prompt),
        completionPrice: price(model.pricing?.completion),
        imagePrice: price(model.pricing?.image),
        expirationDate: model.expiration_date || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
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
    const payload = await response.json() as { data?: { total_credits?: number; total_usage?: number } };
    return {
      configured: true,
      totalCredits: Number.isFinite(payload.data?.total_credits) ? Number(payload.data?.total_credits) : null,
      totalUsage: Number.isFinite(payload.data?.total_usage) ? Number(payload.data?.total_usage) : null,
      error: null,
    };
  } catch (error) {
    return { configured: true, totalCredits: null, totalUsage: null, error: error instanceof Error ? error.message : "Could not load OpenRouter credits" };
  }
}
