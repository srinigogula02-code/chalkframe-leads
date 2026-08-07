import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getImageGenerationModels } from "@/lib/openrouter-models";

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await sql`SELECT enabled, auto_redesign_on_ad_add, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override, aspect_ratio, quality, creative_guidance, updated_at FROM ai_ad_redesign_settings WHERE id=1`;
  if (!rows[0]) return NextResponse.json({ error: "Settings not found." }, { status: 404 });
  return NextResponse.json({ settings: rows[0] });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const model = clean(body.model, 200);
  const fallbackModel = clean(body.fallbackModel, 200);
  const temperature = finite(body.temperature);
  const maxOutputTokens = finite(body.maxOutputTokens);
  const maxCostUsd = finite(body.maxCostUsd);
  const monthlyBudgetUsd = finite(body.monthlyBudgetUsd);
  const systemPromptOverride = clean(body.systemPromptOverride, 30_000);
  const autoRedesignOnAdAdd = Boolean(body.autoRedesignOnAdAdd);
  const aspectRatio = clean(body.aspectRatio, 20) || "1:1";
  const quality = clean(body.quality, 20) || "high";
  const creativeGuidance = clean(body.creativeGuidance, 5_000);

  if (!model) return NextResponse.json({ error: "Choose a primary image generation model." }, { status: 400 });
  if (fallbackModel && fallbackModel === model) return NextResponse.json({ error: "The fallback model must be different from the primary model." }, { status: 400 });
  if (temperature === null || temperature < 0 || temperature > 2) return NextResponse.json({ error: "Temperature must be between 0 and 2." }, { status: 400 });
  if (maxOutputTokens === null || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 200 || maxOutputTokens > 4_000) return NextResponse.json({ error: "Maximum output tokens must be a whole number between 200 and 4,000." }, { status: 400 });
  if (maxCostUsd === null || maxCostUsd <= 0 || maxCostUsd > 10) return NextResponse.json({ error: "Per-image cost limit must be between $0.001 and $10." }, { status: 400 });
  if (monthlyBudgetUsd === null || monthlyBudgetUsd <= 0 || monthlyBudgetUsd > 10_000) return NextResponse.json({ error: "Monthly budget must be between $0.01 and $10,000." }, { status: 400 });

  const available = await getImageGenerationModels();
  if (available.length) {
    const ids = new Set(available.map(option => option.id));
    if (!ids.has(model)) return NextResponse.json({ error: `Model "${model}" is not a recognized vision/image generation model.` }, { status: 400 });
    if (fallbackModel && !ids.has(fallbackModel)) return NextResponse.json({ error: `Fallback model "${fallbackModel}" is not a recognized vision/image generation model.` }, { status: 400 });
  }

  const rows = await sql`UPDATE ai_ad_redesign_settings
    SET enabled=${body.enabled !== false}, auto_redesign_on_ad_add=${autoRedesignOnAdAdd}, model=${model},
        fallback_model=${fallbackModel || null}, temperature=${temperature}, max_output_tokens=${maxOutputTokens},
        max_cost_usd=${maxCostUsd}, monthly_budget_usd=${monthlyBudgetUsd}, system_prompt_override=${systemPromptOverride || null},
        aspect_ratio=${aspectRatio}, quality=${quality}, creative_guidance=${creativeGuidance || null},
        updated_by=${user.id}, updated_at=now()
    WHERE id=1 RETURNING enabled, auto_redesign_on_ad_add, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override, aspect_ratio, quality, creative_guidance, updated_at`;

  if (!rows[0]) return NextResponse.json({ error: "AI ad redesign settings are not initialized." }, { status: 500 });
  return NextResponse.json({ saved: true, settings: rows[0] });
}
