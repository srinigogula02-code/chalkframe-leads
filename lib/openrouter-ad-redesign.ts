import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getEffectiveAdRedesignPrompt } from "./ad-redesign-prompt";
import { processAdCreativeImage } from "./ad-creative-processor";
import { sql } from "./db";
import { uploadLeadImage } from "./r2";

type AdRedesignSettings = {
  enabled: boolean;
  model: string;
  fallback_model: string | null;
  max_cost_usd: number;
  monthly_budget_usd: number;
  system_prompt_override: string | null;
  aspect_ratio: string;
  quality: string;
  creative_guidance: string | null;
};

type GenerationResponse = {
  id?: string;
  model?: string;
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number };
};

const IMAGE_TIMEOUT_MS = 180_000;

function autoAspectRatio(width: number, height: number): string {
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const choices = [
    { value: "1:1", target: 1.0 },
    { value: "4:5", target: 0.8 },
    { value: "9:16", target: 9 / 16 },
    { value: "16:9", target: 16 / 9 },
    { value: "4:3", target: 4 / 3 },
    { value: "3:4", target: 3 / 4 },
  ];
  choices.sort((a, b) => Math.abs(Math.log(ratio / a.target)) - Math.abs(Math.log(ratio / b.target)));
  return choices[0].value;
}

function buildPrompt(leadTitle: string, override: string | null | undefined, creativeGuidance: string | null | undefined) {
  const basePrompt = getEffectiveAdRedesignPrompt(override);
  const parts = [
    `Business: ${leadTitle}.`,
    basePrompt,
  ];

  if (creativeGuidance && creativeGuidance.trim()) {
    parts.push(`Creative Guidance & Style: ${creativeGuidance.trim()}`);
  }

  return parts.join("\n\n");
}

async function markRunFailed(runId: string, startedAt: number, code: string, message: string) {
  await sql`UPDATE lead_ad_redesign_runs SET status='failed', error_code=${code}, error_message=${message.slice(0, 1000)}, latency_ms=${Date.now() - startedAt}, completed_at=now() WHERE id=${runId}`;
}

export async function generateAdRedesign({
  leadId,
  sourceImageId,
  trigger = "manual",
}: {
  leadId: string;
  sourceImageId: string;
  trigger?: "manual" | "automatic";
}) {
  const startedAt = Date.now();
  const [settingsRows, sourceRows, monthlySpendRows] = await Promise.all([
    sql`SELECT enabled, model, fallback_model, max_cost_usd, monthly_budget_usd, system_prompt_override, aspect_ratio, quality, creative_guidance FROM ai_ad_redesign_settings WHERE id=1`,
    sql`SELECT l.title, i.id, i.url FROM leads l JOIN lead_images i ON i.lead_id=l.id WHERE l.id=${leadId} AND i.id=${sourceImageId} LIMIT 1`,
    sql`SELECT COALESCE(SUM(cost_usd), 0)::text AS spend FROM lead_ad_redesign_runs WHERE created_at >= date_trunc('month', now()) AND status='completed'`,
  ]);

  const settings = settingsRows[0] as unknown as AdRedesignSettings | undefined;
  const source = sourceRows[0] as { title: string | null; id: string; url: string } | undefined;

  if (!settings) throw new Error("AI ad redesign settings are not initialized.");
  if (!source) throw new Error("Choose an ad creative that belongs to this business.");
  if (!settings.enabled) throw new Error("AI ad redesign generation is paused in settings.");
  if (Number(monthlySpendRows[0]?.spend || 0) >= Number(settings.monthly_budget_usd)) throw new Error("Monthly AI ad redesign budget limit reached.");

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const models = [settings.model, settings.fallback_model].filter((model, index, list): model is string => Boolean(model?.trim()) && list.indexOf(model) === index);
  if (!models.length) throw new Error("Choose an image model in AI Ad Redesign settings.");

  const leadTitle = String(source.title || "Meta ad business");
  const prompt = buildPrompt(leadTitle, settings.system_prompt_override, settings.creative_guidance);
  const processedSource = await processAdCreativeImage(source.url);

  const runRows = await sql`INSERT INTO lead_ad_redesign_runs (lead_id, source_image_id, source_image_url, lead_title, trigger, status, requested_model, prompt_used)
    VALUES (${leadId}, ${source.id}, ${processedSource.url}, ${leadTitle}, ${trigger}, 'processing', ${models[0]}, ${prompt}) RETURNING id`;
  const runId = String(runRows[0].id);

  let targetAspectRatio = settings.aspect_ratio || "1:1";
  if (targetAspectRatio === "auto") {
    targetAspectRatio = autoAspectRatio(processedSource.width, processedSource.height);
  }

  try {
    let lastFailure = "";
    for (const model of models) {
      const requestPayload: Record<string, unknown> = {
        model,
        prompt,
        input_references: [
          {
            type: "image_url",
            image_url: {
              url: processedSource.url,
            },
          },
        ],
      };

      if (targetAspectRatio) requestPayload.aspect_ratio = targetAspectRatio;
      if (settings.quality) requestPayload.quality = settings.quality;

      const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://leads.chalkframe.com",
          "X-Title": "Chalkframe Performance Ad Redesign",
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastFailure = `${model} returned ${response.status}: ${errorText.slice(0, 500)}`;
        console.error(`[AI Ad Redesign] ${model} failed:`, response.status, errorText);
        continue;
      }

      const payload = (await response.json()) as GenerationResponse;
      const imageB64 = payload.data?.[0]?.b64_json;
      if (!imageB64) {
        lastFailure = `${model} returned no image bytes.`;
        continue;
      }

      const generated = Buffer.from(imageB64, "base64");
      try {
        await sharp(generated, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
      } catch {
        lastFailure = `${model} returned invalid image bytes.`;
        continue;
      }

      const cost = Number(payload.usage?.cost || 0);
      if (cost > Number(settings.max_cost_usd) && Number(settings.max_cost_usd) > 0) {
        await markRunFailed(runId, startedAt, "PER_IMAGE_COST_LIMIT", `The generated image cost $${cost.toFixed(4)}, exceeding limit of $${Number(settings.max_cost_usd).toFixed(4)}.`);
        throw new Error("The generated image exceeded the per-image cost limit and was not saved.");
      }

      const compressed = await sharp(generated).webp({ quality: 92 }).toBuffer();
      const redesignUrl = await uploadLeadImage({
        key: `redesigns/${randomUUID()}.webp`,
        bytes: new Uint8Array(compressed),
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      });

      const positionRows = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM redesign_images WHERE lead_id=${leadId}`;
      const redesignRows = await sql`INSERT INTO redesign_images (lead_id, url, description, position, collage_status, collage_source_image_id, collage_requested_at)
        VALUES (${leadId}, ${redesignUrl}, 'AI redesign generated from selected ad creative', ${Number(positionRows[0].position)}, 'queued', ${source.id}, now()) RETURNING id`;
      const redesignId = String(redesignRows[0].id);

      await sql.transaction([
        sql`UPDATE leads SET collage_original_image_id=${source.id}, workflow_status=CASE WHEN workflow_status IN ('research_pending', 'research_completed') THEN 'redesign_created' ELSE workflow_status END, updated_at=now() WHERE id=${leadId}`,
        sql`UPDATE lead_ad_redesign_runs SET status='completed', actual_model=${payload.model || model}, generation_id=${payload.id || null}, redesign_image_id=${redesignId}, redesign_image_url=${redesignUrl}, cost_usd=${cost || null}, latency_ms=${Date.now() - startedAt}, completed_at=now() WHERE id=${runId}`,
      ]);

      return {
        runId,
        redesignId,
        redesignUrl,
        sourceUrl: processedSource.url,
        latencyMs: Date.now() - startedAt,
        costUsd: cost || null,
        actualModel: payload.model || model,
      };
    }

    await markRunFailed(runId, startedAt, "REFERENCE_GENERATION_FAILED", lastFailure || "No configured model could generate from the source creative.");
    throw new Error(lastFailure || "No configured model could generate from the selected creative.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI ad redesign generation failed.";
    await sql`UPDATE lead_ad_redesign_runs SET status='failed', error_message=COALESCE(error_message, ${message}), latency_ms=${Date.now() - startedAt}, completed_at=COALESCE(completed_at, now()) WHERE id=${runId} AND status='processing'`;
    throw error;
  }
}
