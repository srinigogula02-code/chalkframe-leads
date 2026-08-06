import "server-only";

import { OpenRouter } from "@openrouter/agent";
import { maxCost, stepCountIs } from "@openrouter/agent/stop-conditions";
import { DEFAULT_EMAIL_SYSTEM_PROMPT, EMAIL_PROMPT_VERSION, buildEmailInput } from "@/lib/email-prompt";
import { sql } from "@/lib/db";

type EmailSettings = {
  enabled: boolean;
  model: string;
  fallback_model: string | null;
  temperature: string | number;
  max_output_tokens: number;
  max_cost_usd: string | number;
  monthly_budget_usd: string | number;
  system_prompt_override: string | null;
};

type DraftRow = {
  id: string;
  lead_id: string;
  redesign_image_id: string;
  source_collage_url: string;
  recipient_email: string | null;
  requested_trigger: string;
  title: string | null;
};

type ParsedOutput =
  | { kind: "email"; subject: string; body: string }
  | { kind: "needs_review"; reason: string };

type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

type ModelAttempt = {
  text: string;
  generationId: string;
  actualModel: string;
  latencyMs: number;
  usage: ModelUsage;
};

const MAX_DRAFTS_PER_RUN = 4;
const PROCESSING_TIMEOUT_MINUTES = 5;
const MAX_ERROR_LENGTH = 1_000;

function number(value: string | number | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanOutput(value: string) {
  return value.trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function validateAndParseOutput(value: string): { parsed?: ParsedOutput; error?: string } {
  const output = cleanOutput(value);
  if (!output) return { error: "The model returned an empty response." };
  if (/^REDESIGN_REVIEW_NEEDED\b/i.test(output)) {
    const reason = output.replace(/^REDESIGN_REVIEW_NEEDED\b[:\s-]*/i, "").trim();
    return reason
      ? { parsed: { kind: "needs_review", reason } }
      : { error: "The model flagged the redesign but did not explain what needs improvement." };
  }

  const lines = output.split(/\r?\n/);
  const firstContent = lines.findIndex(line => line.trim().length > 0);
  const subjectMatch = firstContent >= 0 ? lines[firstContent].match(/^subject\s*:\s*(.+)$/i) : null;
  if (!subjectMatch?.[1]?.trim()) return { error: "The email is missing a Subject line." };
  const subject = subjectMatch[1].trim().slice(0, 240);
  const body = lines.slice(firstContent + 1).join("\n").trim();
  const count = wordCount(body);
  if (count < 110 || count > 200) return { error: `The email body is ${count} words; it must stay close to 120–180 words.` };
  const bullets = body.split(/\r?\n/).filter(line => /^\s*[-•*]\s+\S/.test(line)).length;
  if (bullets < 3 || bullets > 5) return { error: "The email must contain 3 to 5 short improvement bullets." };
  if (/\b(?:AI|ChatGPT|artificial intelligence|automation|automated)\b/i.test(body)) return { error: "The email mentioned prohibited generation or automation language." };
  if (!/\$(?:19|250)\b/.test(body)) return { error: "The email is missing the brief pricing line." };
  if (!/Srinivas\s+Gogula/i.test(body)) return { error: "The email is missing the required sender signature." };
  return { parsed: { kind: "email", subject, body } };
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status", "code"]) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

function getErrorCode(error: unknown) {
  const status = getErrorStatus(error);
  if (status === 401) return "invalid_api_key";
  if (status === 402) return "insufficient_credits";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "provider_unavailable";
  return "generation_failed";
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Email generation failed.";
  return message.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, MAX_ERROR_LENGTH);
}

async function loadSettings(): Promise<EmailSettings> {
  const rows = await sql`SELECT enabled, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override FROM ai_settings WHERE id=1`;
  if (!rows[0]) throw new Error("AI email settings are not initialized. Apply migration 007_openrouter_email_drafts.sql.");
  return rows[0] as unknown as EmailSettings;
}

export async function queueEmailDraftsForLead(
  leadId: string,
  options: { redesignImageId?: string; force?: boolean; trigger?: "automatic" | "manual" | "regenerate" } = {},
) {
  const settings = await loadSettings();
  const redesignImageId = options.redesignImageId || "";
  const trigger = options.trigger || "automatic";
  const rows = await sql`INSERT INTO lead_email_drafts (
      lead_id, redesign_image_id, source_collage_url, recipient_email, status, requested_model,
      prompt_version, requested_at, requested_trigger, updated_at
    )
    SELECT l.id, r.id, r.collage_url, NULLIF(BTRIM(l.email), ''),
      CASE WHEN ${settings.enabled} THEN 'queued' ELSE 'waiting' END,
      ${settings.model}, ${EMAIL_PROMPT_VERSION}, CASE WHEN ${settings.enabled} THEN now() ELSE NULL END,
      ${trigger}, now()
    FROM redesign_images r JOIN leads l ON l.id=r.lead_id
    WHERE r.lead_id=${leadId} AND r.collage_status='completed' AND r.collage_url IS NOT NULL
      AND (${!redesignImageId} OR r.id=${redesignImageId || null}::uuid)
    ON CONFLICT (redesign_image_id) DO UPDATE SET
      source_collage_url=EXCLUDED.source_collage_url,
      recipient_email=EXCLUDED.recipient_email,
      status=CASE
        WHEN ${Boolean(options.force)} THEN CASE WHEN ${settings.enabled} THEN 'queued' ELSE 'waiting' END
        WHEN lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url
          OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email
          THEN CASE WHEN ${settings.enabled} THEN 'queued' ELSE 'waiting' END
        WHEN lead_email_drafts.status='waiting' AND ${settings.enabled} THEN 'queued'
        WHEN lead_email_drafts.status='blocked' AND lead_email_drafts.error_code='missing_api_key' AND ${Boolean(process.env.OPENROUTER_API_KEY?.trim())} THEN 'queued'
        ELSE lead_email_drafts.status
      END,
      requested_model=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN EXCLUDED.requested_model ELSE lead_email_drafts.requested_model END,
      prompt_version=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN EXCLUDED.prompt_version ELSE lead_email_drafts.prompt_version END,
      requested_at=CASE WHEN (${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email OR lead_email_drafts.status='waiting' OR (lead_email_drafts.status='blocked' AND lead_email_drafts.error_code='missing_api_key' AND ${Boolean(process.env.OPENROUTER_API_KEY?.trim())})) AND ${settings.enabled} THEN now() ELSE lead_email_drafts.requested_at END,
      requested_trigger=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN EXCLUDED.requested_trigger ELSE lead_email_drafts.requested_trigger END,
      subject=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.subject END,
      body=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.body END,
      review_reason=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.review_reason END,
      error_code=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.error_code END,
      error_message=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.error_message END,
      started_at=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.started_at END,
      completed_at=CASE WHEN ${Boolean(options.force)} OR lead_email_drafts.source_collage_url IS DISTINCT FROM EXCLUDED.source_collage_url OR lead_email_drafts.recipient_email IS DISTINCT FROM EXCLUDED.recipient_email THEN NULL ELSE lead_email_drafts.completed_at END,
      updated_at=now()
    RETURNING id, status`;
  return { queued: rows.filter(row => row.status === "queued").length, drafts: rows.length, enabled: settings.enabled };
}

async function callModelOnce({
  apiKey,
  settings,
  draft,
  correction,
  costLimit,
}: {
  apiKey: string;
  settings: EmailSettings;
  draft: DraftRow;
  correction?: string;
  costLimit: number;
}): Promise<ModelAttempt> {
  const client = new OpenRouter({
    apiKey,
    httpReferer: process.env.NEXT_PUBLIC_APP_URL || "https://leads.chalkframe.com",
    appTitle: "Chalkframe Leads",
    timeoutMs: 50_000,
    retryConfig: { strategy: "backoff", backoff: { initialInterval: 800, maxInterval: 6_000, exponent: 2, maxElapsedTime: 18_000 }, retryConnectionErrors: true },
  });
  const start = Date.now();
  const fallback = settings.fallback_model?.trim();
  const inputText = [
    buildEmailInput({ businessTitle: draft.title, recipientEmail: draft.recipient_email }),
    correction ? `\nCORRECTION REQUIRED\n${correction}\nReturn a corrected result only.` : "",
  ].join("");
  const result = client.callModel({
    model: settings.model,
    models: fallback && fallback !== settings.model ? [fallback] : undefined,
    instructions: settings.system_prompt_override?.trim() || DEFAULT_EMAIL_SYSTEM_PROMPT,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: inputText },
        { type: "input_image", imageUrl: draft.source_collage_url, detail: "high" },
      ],
    }],
    maxOutputTokens: settings.max_output_tokens,
    temperature: number(settings.temperature, 0.35),
    modalities: ["text"],
    metadata: {
      workflow: "chalkframe-email-draft",
      lead_id: draft.lead_id,
      redesign_image_id: draft.redesign_image_id,
      prompt_version: EMAIL_PROMPT_VERSION,
    },
    sessionId: `chalkframe-email-${draft.lead_id}`,
    safetyIdentifier: draft.lead_id,
    promptCacheKey: EMAIL_PROMPT_VERSION,
    store: false,
    stopWhen: [stepCountIs(1), maxCost(costLimit)],
  }, { signal: AbortSignal.timeout(55_000) });
  const response = await result.getResponse();
  const usage = response.usage;
  return {
    text: response.outputText || "",
    generationId: response.id,
    actualModel: response.model || settings.model,
    latencyMs: Date.now() - start,
    usage: {
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      totalTokens: usage?.totalTokens || 0,
      cost: number(usage?.cost),
    },
  };
}

async function generateValidatedDraft(apiKey: string, settings: EmailSettings, draft: DraftRow) {
  const attempts: ModelAttempt[] = [];
  const totalCostLimit = number(settings.max_cost_usd, 0.10);
  let correction: string | undefined;
  for (let validationAttempt = 0; validationAttempt < 2; validationAttempt += 1) {
    const spent = attempts.reduce((sum, attempt) => sum + attempt.usage.cost, 0);
    const remainingCost = totalCostLimit - spent;
    if (remainingCost <= 0) throw new Error(`The generated email reached the $${totalCostLimit.toFixed(3)} per-email cost limit before it passed validation.`);
    const result = await callModelOnce({ apiKey, settings, draft, correction, costLimit: remainingCost });
    attempts.push(result);
    const validated = validateAndParseOutput(result.text);
    if (validated.parsed) {
      return {
        parsed: validated.parsed,
        rawOutput: result.text,
        generationId: result.generationId,
        actualModel: result.actualModel,
        latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
        usage: attempts.reduce<ModelUsage>((total, attempt) => ({
          inputTokens: total.inputTokens + attempt.usage.inputTokens,
          outputTokens: total.outputTokens + attempt.usage.outputTokens,
          totalTokens: total.totalTokens + attempt.usage.totalTokens,
          cost: total.cost + attempt.usage.cost,
        }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }),
      };
    }
    correction = validated.error;
  }
  throw new Error(correction || "The generated email did not pass validation.");
}

async function markBlocked(draft: DraftRow, settings: EmailSettings, code: string, message: string) {
  const run = await sql`INSERT INTO ai_generation_runs (draft_id, lead_id, redesign_image_id, lead_title, trigger, status, requested_model, prompt_version, input_image_url, recipient_email, error_code, error_message, completed_at)
    VALUES (${draft.id}, ${draft.lead_id}, ${draft.redesign_image_id}, ${draft.title}, ${draft.requested_trigger}, 'blocked', ${settings.model}, ${EMAIL_PROMPT_VERSION}, ${draft.source_collage_url}, ${draft.recipient_email}, ${code}, ${message}, now()) RETURNING id`;
  await sql`UPDATE lead_email_drafts SET status='blocked', error_code=${code}, error_message=${message}, started_at=NULL, completed_at=now(), updated_at=now()
    WHERE id=${draft.id} AND status='processing' AND source_collage_url=${draft.source_collage_url}`;
  return run[0]?.id;
}

export async function processEmailDraftQueue(leadId: string) {
  const settings = await loadSettings();
  if (!settings.enabled) {
    await sql`UPDATE lead_email_drafts SET status='waiting', started_at=NULL, updated_at=now() WHERE lead_id=${leadId} AND status IN ('queued','processing')`;
    return { processed: 0, blocked: 0 };
  }

  await sql`UPDATE lead_email_drafts SET status='queued', error_code='processing_timeout', error_message='The previous background run timed out and was queued again.', started_at=NULL, requested_at=now(), updated_at=now()
    WHERE lead_id=${leadId} AND status='processing' AND started_at < now() - (${PROCESSING_TIMEOUT_MINUTES} * interval '1 minute')`;
  const claimed = await sql`WITH candidates AS (
      SELECT d.id FROM lead_email_drafts d
      JOIN redesign_images r ON r.id=d.redesign_image_id
      WHERE d.lead_id=${leadId} AND d.status='queued' AND r.collage_status='completed' AND r.collage_url=d.source_collage_url
      ORDER BY d.requested_at NULLS FIRST, d.created_at
      LIMIT ${MAX_DRAFTS_PER_RUN}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE lead_email_drafts d SET status='processing', started_at=now(), error_code=NULL, error_message=NULL,
      attempt_count=d.attempt_count+1, updated_at=now()
    FROM candidates, leads l
    WHERE d.id=candidates.id AND l.id=d.lead_id
    RETURNING d.id, d.lead_id, d.redesign_image_id, d.source_collage_url, d.recipient_email, d.requested_trigger, l.title` as DraftRow[];
  if (!claimed.length) return { processed: 0, blocked: 0 };

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    await Promise.all(claimed.map(draft => markBlocked(draft, settings, "missing_api_key", "OPENROUTER_API_KEY is not configured in Vercel.")));
    return { processed: 0, blocked: claimed.length };
  }

  const spendRows = await sql`SELECT COALESCE(SUM(cost_usd),0)::text AS spent FROM ai_generation_runs
    WHERE created_at >= date_trunc('month', now()) AND status IN ('completed','needs_review')`;
  let monthlySpent = number(spendRows[0]?.spent);
  const monthlyBudget = number(settings.monthly_budget_usd, 25);
  const perRequestLimit = number(settings.max_cost_usd, 0.10);
  let processed = 0;
  let blocked = 0;

  for (const draft of claimed) {
    if (monthlySpent + perRequestLimit > monthlyBudget) {
      await markBlocked(draft, settings, "monthly_budget_reached", `The monthly AI budget of $${monthlyBudget.toFixed(2)} has been reached.`);
      blocked += 1;
      continue;
    }
    const runRows = await sql`INSERT INTO ai_generation_runs (draft_id, lead_id, redesign_image_id, lead_title, trigger, status, requested_model, prompt_version, input_image_url, recipient_email)
      VALUES (${draft.id}, ${draft.lead_id}, ${draft.redesign_image_id}, ${draft.title}, ${draft.requested_trigger}, 'processing', ${settings.model}, ${EMAIL_PROMPT_VERSION}, ${draft.source_collage_url}, ${draft.recipient_email}) RETURNING id`;
    const runId = String(runRows[0].id);
    try {
      const generated = await generateValidatedDraft(apiKey, settings, draft);
      monthlySpent += generated.usage.cost;
      const isReview = generated.parsed.kind === "needs_review";
      const status = isReview ? "needs_review" : "completed";
      const subject = generated.parsed.kind === "email" ? generated.parsed.subject : null;
      const body = generated.parsed.kind === "email" ? generated.parsed.body : null;
      const reviewReason = generated.parsed.kind === "needs_review" ? generated.parsed.reason : null;
      await sql.transaction([
        sql`UPDATE lead_email_drafts SET status=${status}, subject=${subject}, body=${body}, raw_output=${generated.rawOutput}, review_reason=${reviewReason},
          error_code=NULL, error_message=NULL, requested_model=${settings.model}, actual_model=${generated.actualModel}, generation_id=${generated.generationId},
          prompt_version=${EMAIL_PROMPT_VERSION}, input_tokens=${generated.usage.inputTokens}, output_tokens=${generated.usage.outputTokens}, total_tokens=${generated.usage.totalTokens},
          cost_usd=${generated.usage.cost}, latency_ms=${generated.latencyMs}, completed_at=now(), started_at=NULL, updated_at=now()
          WHERE id=${draft.id} AND status='processing' AND source_collage_url=${draft.source_collage_url}`,
        sql`UPDATE ai_generation_runs SET status=${status}, actual_model=${generated.actualModel}, generation_id=${generated.generationId},
          input_tokens=${generated.usage.inputTokens}, output_tokens=${generated.usage.outputTokens}, total_tokens=${generated.usage.totalTokens},
          cost_usd=${generated.usage.cost}, latency_ms=${generated.latencyMs}, completed_at=now() WHERE id=${runId}`,
      ]);
      processed += 1;
    } catch (error) {
      const code = getErrorCode(error);
      const message = getErrorMessage(error);
      await sql.transaction([
        sql`UPDATE lead_email_drafts SET status='failed', error_code=${code}, error_message=${message}, started_at=NULL, completed_at=now(), updated_at=now()
          WHERE id=${draft.id} AND status='processing' AND source_collage_url=${draft.source_collage_url}`,
        sql`UPDATE ai_generation_runs SET status='failed', error_code=${code}, error_message=${message}, completed_at=now() WHERE id=${runId}`,
      ]);
    }
  }
  return { processed, blocked };
}
