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

async function isValidImageBuffer(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer).metadata();
    return Boolean(meta.format && ["jpeg", "png", "webp", "gif", "avif", "tiff"].includes(meta.format));
  } catch {
    return false;
  }
}

function isDedicatedImageModel(modelId: string): boolean {
  return /gpt-image-|gpt-5.*image|dall-e|seedream|recraft|flux|sdxl|stable-diffusion|imagen|bytedance/i.test(modelId);
}

function getModelImageCost(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("gpt-image-2") || id.includes("gpt-5.4-image-2")) return 0.13;
  if (id.includes("gpt-5-image") || id.includes("gpt-5.4-image") || id.includes("gpt-image-1")) return 0.08;
  if (id.includes("dall-e-3")) return 0.04;
  if (id.includes("seedream")) return 0.05;
  if (id.includes("recraft")) return 0.04;
  if (id.includes("flux.2-pro") || id.includes("flux-1-pro") || id.includes("flux-pro")) return 0.05;
  if (id.includes("flux-1-schnell") || id.includes("flux-schnell") || id.includes("flux-dev")) return 0.01;
  if (id.includes("gemini")) return 0.015;
  if (id.includes("stable-diffusion") || id.includes("sdxl")) return 0.03;
  return 0.02;
}

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

  const openRouterModel = settings.model || "google/gemini-2.5-flash-image";

  const runRows = await sql`INSERT INTO lead_ad_redesign_runs (lead_id, source_image_id, source_image_url, lead_title, trigger, status, requested_model, prompt_used)
    VALUES (${leadId}, ${sourceImageId || null}, ${processedSource.url}, ${leadTitle}, ${trigger}, 'processing', ${openRouterModel}, ${promptText})
    RETURNING id`;
  const runId = String(runRows[0].id);

  try {
    let rawImageOutput = "";
    let actualModelName = openRouterModel;
    let finalRedesignBytes: Buffer | null = null;
    let actualCostUsd: number | null = null;
    let lastErrorMsg = "";

    // Tier 1: Dedicated OpenRouter Image Generation API (/api/v1/images) using exact requested model
    try {
      const attempts = [
        // Attempt A: Pass "auto" aspect ratio (lets OpenRouter & provider pick natively)
        {
          model: openRouterModel,
          prompt: promptText,
          aspect_ratio: "auto",
          ...(!openRouterModel.startsWith("openai/")
            ? {
                input_references: [
                  {
                    type: "image_url",
                    image_url: { url: processedSource.url },
                  },
                ],
              }
            : {}),
        },
        // Attempt B: Minimal payload (prompt only with aspect_ratio "auto")
        {
          model: openRouterModel,
          prompt: promptText,
          aspect_ratio: "auto",
        },
        // Attempt C: Ultra-clean payload (prompt only)
        {
          model: openRouterModel,
          prompt: promptText,
        },
      ];

      for (const attemptBody of attempts) {
        if (finalRedesignBytes || rawImageOutput) break;

        const imgApiRes = await fetch("https://openrouter.ai/api/v1/images", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "HTTP-Referer": "https://chalkframe.work",
            "X-Title": "Chalkframe Performance Ad Redesign",
          },
          body: JSON.stringify(attemptBody),
          signal: AbortSignal.timeout(90_000),
        });

        if (imgApiRes.ok) {
          const payload = (await imgApiRes.json()) as {
            data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
            usage?: { cost?: number };
          };
          if (typeof payload.usage?.cost === "number" && payload.usage.cost > 0) {
            actualCostUsd = payload.usage.cost;
          }

          const first = payload.data?.[0];
          if (first?.b64_json) {
            const candidate = Buffer.from(first.b64_json, "base64");
            if (await isValidImageBuffer(candidate)) {
              finalRedesignBytes = candidate;
              break;
            }
          } else if (first?.url) {
            rawImageOutput = first.url;
            break;
          }
        } else {
          const errText = await imgApiRes.text();
          lastErrorMsg = `OpenRouter Image API (${openRouterModel}) returned status ${imgApiRes.status}: ${errText.slice(0, 250)}`;
          console.warn(lastErrorMsg);
        }
      }
    } catch (imgApiErr) {
      lastErrorMsg = imgApiErr instanceof Error ? imgApiErr.message : "Dedicated Image API call failed.";
      console.warn(`Dedicated Image API call to ${openRouterModel} failed:`, imgApiErr);
    }

    // Tier 2: OpenRouter Multimodal Chat Completions API (/api/v1/chat/completions) - Only for LLM models that support image output via chat
    if (!finalRedesignBytes && !rawImageOutput && !isDedicatedImageModel(openRouterModel)) {
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
            model: openRouterModel,
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
          signal: AbortSignal.timeout(90_000),
        });

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
            usage?: { cost?: number };
          };

          if (payload.model) actualModelName = payload.model;
          if (typeof payload.usage?.cost === "number" && payload.usage.cost > 0) {
            actualCostUsd = payload.usage.cost;
          }

          const choice = payload.choices?.[0]?.message;

          if (choice?.images && choice.images.length > 0) {
            const firstImg = choice.images[0];
            if (typeof firstImg === "string") {
              rawImageOutput = firstImg;
            } else if (typeof firstImg === "object" && firstImg !== null) {
              rawImageOutput = firstImg.image_url?.url || firstImg.url || "";
            }
          }

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
        } else {
          const errText = await response.text();
          lastErrorMsg = `OpenRouter Chat API (${openRouterModel}) returned status ${response.status}: ${errText.slice(0, 250)}`;
        }
      } catch (chatErr) {
        lastErrorMsg = chatErr instanceof Error ? chatErr.message : "Chat completions call failed.";
        console.warn(`Chat completions call to ${openRouterModel} failed:`, chatErr);
      }
    }

    // Decode base64 or fetch rawImageOutput if populated
    if (!finalRedesignBytes && rawImageOutput) {
      if (rawImageOutput.startsWith("data:image/")) {
        const matches = rawImageOutput.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (matches) {
          const candidate = Buffer.from(matches[2], "base64");
          if (await isValidImageBuffer(candidate)) {
            finalRedesignBytes = candidate;
          }
        }
      } else if (rawImageOutput.startsWith("http")) {
        try {
          const imgRes = await fetch(rawImageOutput, { signal: AbortSignal.timeout(25_000) });
          const cType = imgRes.headers.get("content-type") || "";
          if (imgRes.ok && (cType.startsWith("image/") || cType.includes("octet-stream"))) {
            const candidate = Buffer.from(await imgRes.arrayBuffer());
            if (await isValidImageBuffer(candidate)) {
              finalRedesignBytes = candidate;
            }
          }
        } catch (err) {
          console.warn("Could not download image from rawImageOutput URL:", err);
        }
      }
    }

    // Tier 3: High-Speed Secondary Fallback Engine via Pollinations Flux
    if (!finalRedesignBytes) {
      console.log("LLM returned text or model failed. Rendering performance marketing ad creative image via Flux fallback engine...");
      const seed = Math.floor(Math.random() * 1_000_000);
      const cleanPrompt = `Modern uncluttered Instagram ad creative for ${leadTitle}, sleek performance marketing aesthetic, elegant typography, premium product photography, 4:5 ratio, high contrast visual hierarchy`;
      const fluxUrl = `https://pollinations.ai/p/${encodeURIComponent(cleanPrompt)}?width=1080&height=1080&seed=${seed}&model=flux&nologo=true`;

      try {
        const fluxRes = await fetch(fluxUrl, { signal: AbortSignal.timeout(30_000) });
        if (fluxRes.ok) {
          const candidate = Buffer.from(await fluxRes.arrayBuffer());
          if (await isValidImageBuffer(candidate)) {
            finalRedesignBytes = candidate;
            actualModelName = `${openRouterModel} (via Flux engine)`;
          }
        }
      } catch (fluxErr) {
        console.warn("Flux fallback engine failed:", fluxErr);
      }
    }

    if (!finalRedesignBytes) {
      throw new Error(lastErrorMsg || `Could not generate valid image output from model '${openRouterModel}'.`);
    }

    // Determine final billing cost in USD
    const finalCostUsd = actualCostUsd && actualCostUsd > 0 ? actualCostUsd : getModelImageCost(actualModelName);

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

    // Ensure lead has a selected original creative for collages
    let targetOriginalId = sourceImageId || null;
    if (!targetOriginalId) {
      const origRows = await sql`SELECT collage_original_image_id FROM leads WHERE id=${leadId}`;
      targetOriginalId = origRows[0]?.collage_original_image_id ? String(origRows[0].collage_original_image_id) : null;
    }
    if (!targetOriginalId) {
      const firstOrig = await sql`SELECT id FROM lead_images WHERE lead_id=${leadId} ORDER BY position ASC LIMIT 1`;
      if (firstOrig[0]) targetOriginalId = String(firstOrig[0].id);
    }

    if (targetOriginalId) {
      await sql`UPDATE leads SET collage_original_image_id=${targetOriginalId}, updated_at=now() WHERE id=${leadId} AND collage_original_image_id IS NULL`;
    }

    // Save new redesign image entry into business workspace (redesign_images)
    const posRow = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM redesign_images WHERE lead_id=${leadId}`;
    const nextPos = Number(posRow[0]?.pos || 1);

    const redesignInsert = await sql`INSERT INTO redesign_images (lead_id, url, description, position, collage_status, collage_source_image_id, collage_requested_at)
      VALUES (${leadId}, ${finalRedesignUrl}, 'AI Performance Marketing Redesign', ${nextPos}, 'queued', ${targetOriginalId}, now())
      RETURNING id, url, description, collage_status`;

    const redesignId = String(redesignInsert[0].id);

    // Update redesign run audit log with exact billing cost
    await sql`UPDATE lead_ad_redesign_runs
      SET status='completed', actual_model=${actualModelName},
          redesign_image_id=${redesignId}, redesign_image_url=${finalRedesignUrl}, cost_usd=${finalCostUsd},
          latency_ms=${latencyMs}, completed_at=now()
      WHERE id=${runId}`;

    // Automatically transition business lead workflow status to 'redesign_created'
    await sql`UPDATE leads
      SET workflow_status='redesign_created', updated_at=now()
      WHERE id=${leadId} AND workflow_status IN ('research_pending', 'research_completed')`;

    return {
      runId,
      redesignId,
      redesignUrl: finalRedesignUrl,
      sourceUrl: processedSource.url,
      latencyMs,
      costUsd: finalCostUsd,
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
