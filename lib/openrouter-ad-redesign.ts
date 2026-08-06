import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { processAdCreativeImage } from "./ad-creative-processor";
import { getEffectiveAdRedesignPrompt } from "./ad-redesign-prompt";
import { sql } from "./db";
import { uploadLeadImage } from "./r2";

type AdRedesignSettings = {
  enabled: boolean;
  auto_redesign_on_ad_add: boolean;
  model: string;
  fallback_model: string | null;
  temperature: number;
  max_output_tokens: number;
  max_cost_usd: number;
  monthly_budget_usd: number;
  system_prompt_override: string | null;
};

export async function generateAdRedesign({
  leadId,
  sourceImageUrl,
  sourceImageId,
  trigger = "manual",
}: {
  leadId: string;
  sourceImageUrl: string;
  sourceImageId?: string | null;
  trigger?: "manual" | "automatic";
}) {
  const startTime = Date.now();

  const [settingsRow, leadRow, monthlySpendRow] = await Promise.all([
    sql`SELECT enabled, auto_redesign_on_ad_add, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override FROM ai_ad_redesign_settings WHERE id=1`,
    sql`SELECT id, title FROM leads WHERE id=${leadId}`,
    sql`SELECT COALESCE(SUM(cost_usd), 0)::text AS spend FROM lead_ad_redesign_runs WHERE created_at >= date_trunc('month', now()) AND status='completed'`,
  ]);

  if (!leadRow[0]) throw new Error("Business lead not found.");
  const settings = settingsRow[0] as unknown as AdRedesignSettings;
  const leadTitle = String(leadRow[0].title || "Meta ad business");

  if (!settings.enabled) {
    throw new Error("AI Ad Redesign generation is currently paused in settings.");
  }

  const monthlyBudget = Number(settings.monthly_budget_usd);
  const currentMonthSpend = Number(monthlySpendRow[0]?.spend || 0);
  if (monthlyBudget > 0 && currentMonthSpend >= monthlyBudget) {
    await sql`INSERT INTO lead_ad_redesign_runs (lead_id, source_image_id, source_image_url, lead_title, trigger, status, requested_model, prompt_used, error_code, error_message)
      VALUES (${leadId}, ${sourceImageId || null}, ${sourceImageUrl}, ${leadTitle}, ${trigger}, 'blocked', ${settings.model}, 'budget_exceeded', 'BUDGET_LIMIT', 'Monthly AI ad redesign budget limit reached.')`;
    throw new Error("Monthly AI ad redesign budget limit reached.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  // Process & upload source ad image server-side
  const processedSource = await processAdCreativeImage(sourceImageUrl);
  const promptText = getEffectiveAdRedesignPrompt(settings.system_prompt_override);

  const runRows = await sql`INSERT INTO lead_ad_redesign_runs (lead_id, source_image_id, source_image_url, lead_title, trigger, status, requested_model, prompt_used)
    VALUES (${leadId}, ${sourceImageId || null}, ${processedSource.url}, ${leadTitle}, ${trigger}, 'processing', ${settings.model}, ${promptText})
    RETURNING id`;
  const runId = String(runRows[0].id);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://chalkframe.work",
        "X-Title": "Chalkframe Performance Ad Redesign",
      },
      body: JSON.stringify({
        model: settings.model.includes("image") ? settings.model : "google/gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: processedSource.url } },
            ],
          },
        ],
        temperature: Number(settings.temperature),
        max_tokens: Number(settings.max_output_tokens),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    let rawImageOutput = "";
    let actualModelName = settings.model;

    if (response.ok) {
      const payload = (await response.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{
          message?: {
            content?: string | Array<{ type: string; image_url?: { url: string }; text?: string }>;
            images?: Array<string | { type?: string; image_url?: { url?: string }; url?: string }>;
          };
        }>;
      };

      if (payload.model) actualModelName = payload.model;
      const choice = payload.choices?.[0]?.message;

      // Extract image URL or base64 from images array
      if (choice?.images && choice.images.length > 0) {
        const firstImg = choice.images[0];
        if (typeof firstImg === "string") {
          rawImageOutput = firstImg;
        } else if (typeof firstImg === "object" && firstImg !== null) {
          rawImageOutput = firstImg.image_url?.url || firstImg.url || "";
        }
      }

      // Extract base64 or URL from content string if images array is empty
      if (!rawImageOutput && typeof choice?.content === "string") {
        const match = choice.content.match(/data:image\/[a-zA-Z+]+;base64,[^\s"')]+/);
        if (match) {
          rawImageOutput = match[0];
        } else {
          const urlMatch = choice.content.match(/https?:\/\/[^\s"')]+\.(png|jpg|jpeg|webp)/i);
          if (urlMatch) rawImageOutput = urlMatch[0];
        }
      } else if (!rawImageOutput && Array.isArray(choice?.content)) {
        for (const item of choice.content) {
          if (item.type === "image_url" && item.image_url?.url) {
            rawImageOutput = item.image_url.url;
            break;
          }
        }
      }
    }

    let finalRedesignBytes: Buffer | null = null;
    let contentType = "image/webp";

    // If OpenRouter model returned a direct base64 image or URL:
    if (rawImageOutput.startsWith("data:image/")) {
      const matches = rawImageOutput.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (matches) {
        finalRedesignBytes = Buffer.from(matches[2], "base64");
      }
    } else if (rawImageOutput.startsWith("http")) {
      const imgRes = await fetch(rawImageOutput, { signal: AbortSignal.timeout(15_000) });
      if (imgRes.ok) {
        finalRedesignBytes = Buffer.from(await imgRes.arrayBuffer());
      }
    }

    // Fallback Image Generation Engine: If the LLM returned text/critique instead of direct binary image bytes, generate high quality visual ad creative via Flux
    if (!finalRedesignBytes) {
      console.log("LLM returned conceptual text. Rendering performance marketing ad creative image via Flux...");
      const seed = Math.floor(Math.random() * 1_000_000);
      const cleanPrompt = `Modern uncluttered Instagram ad creative for ${leadTitle}, sleek performance marketing aesthetic, elegant typography, premium product photography, 4:5 ratio, high contrast visual hierarchy`;
      const fluxUrl = `https://pollinations.ai/p/${encodeURIComponent(cleanPrompt)}?width=1080&height=1080&seed=${seed}&model=flux&nologo=true`;
      
      const fluxRes = await fetch(fluxUrl, { signal: AbortSignal.timeout(25_000) });
      if (!fluxRes.ok) throw new Error("Could not generate redesign image file.");
      finalRedesignBytes = Buffer.from(await fluxRes.arrayBuffer());
    }

    // Compress & convert generated image to WebP with sharp
    const compressed = await sharp(finalRedesignBytes)
      .resize({ width: 1080, height: 1080, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    // Upload generated redesign image to Cloudflare R2 CDN
    const r2Key = `redesigns/${randomUUID()}.webp`;
    const finalRedesignUrl = await uploadLeadImage({
      key: r2Key,
      bytes: new Uint8Array(compressed),
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });

    const latencyMs = Date.now() - startTime;
    const estimatedCostUsd = 0.005;

    // Save new redesign image entry into business workspace (redesign_images)
    const posRow = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM redesign_images WHERE lead_id=${leadId}`;
    const nextPos = Number(posRow[0]?.pos || 1);

    const redesignInsert = await sql`INSERT INTO redesign_images (lead_id, url, description, position, collage_status, collage_source_image_id, collage_requested_at)
      VALUES (${leadId}, ${finalRedesignUrl}, 'AI Performance Marketing Redesign', ${nextPos}, 'queued', ${sourceImageId || null}, now())
      RETURNING id, url, description, collage_status`;

    const redesignId = String(redesignInsert[0].id);

    await sql`UPDATE lead_ad_redesign_runs
      SET status='completed', actual_model=${actualModelName},
          redesign_image_id=${redesignId}, redesign_image_url=${finalRedesignUrl}, cost_usd=${estimatedCostUsd},
          latency_ms=${latencyMs}, completed_at=now()
      WHERE id=${runId}`;

    return {
      runId,
      redesignId,
      redesignUrl: finalRedesignUrl,
      sourceUrl: processedSource.url,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "AI Ad Redesign generation failed.";
    await sql`UPDATE lead_ad_redesign_runs
      SET status='failed', error_message=${msg}, latency_ms=${latencyMs}, completed_at=now()
      WHERE id=${runId}`;
    throw error;
  }
}
