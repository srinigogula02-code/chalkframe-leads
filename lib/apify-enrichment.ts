import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { compressImage } from "@/lib/compress-image";
import { sql } from "@/lib/db";
import { uploadLeadImage } from "@/lib/r2";
import { decryptSecret } from "@/lib/secret-crypto";

const ADS_ACTOR_ID = "JJghSZmShuco4j9gJ";
const PAGE_ACTOR_ID = "4Hv5RhChiaDk6iwad";
const API_BASE = "https://api.apify.com/v2";
const MAX_WAIT_MS = 5 * 60_000;
const POLL_MS = 3_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Actor schemas vary by input mode and are not published as a stable union.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;
type Trigger = "automatic" | "manual" | "bulk";
type ActorResult = { runId: string; items: JsonRecord[]; costUsd: number; durationMs: number };

type SettingsRow = {
  api_token_ciphertext: string | null;
  token_version: string;
  auto_enrich_on_add: boolean;
  monthly_budget_usd: string | number;
  max_ads_per_business: number;
};

function clean(value: unknown, max = 4_000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

async function settingsWithToken() {
  const rows = await sql`SELECT api_token_ciphertext, token_version, auto_enrich_on_add, monthly_budget_usd, max_ads_per_business FROM apify_enrichment_settings WHERE id=1`;
  const settings = rows[0] as unknown as SettingsRow | undefined;
  if (!settings) throw new Error("Apify settings are not initialized. Apply migration 012.");
  if (!settings.api_token_ciphertext) throw new Error("Add an Apify API key in the Apify dashboard.");
  return { ...settings, token: decryptSecret(settings.api_token_ciphertext) };
}

async function apify(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `Apify request failed (${response.status}).`);
  return body;
}

async function runActor(actorId: string, input: JsonRecord, token: string): Promise<ActorResult> {
  const started = await apify(`/acts/${actorId}/runs`, token, { method: "POST", body: JSON.stringify(input) });
  const startedRun = started?.data as JsonRecord | undefined;
  if (!startedRun?.id) throw new Error(`Actor ${actorId} did not return a run ID.`);
  let run: JsonRecord = startedRun;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    if (Date.now() >= deadline) throw new Error(`Apify actor timed out after five minutes (run ${run.id}).`);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    run = (await apify(`/actor-runs/${run.id}`, token)).data;
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Apify actor ended with status ${run.status} (run ${run.id}).`);
  const items = await apify(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, token);
  // Usage accounting can trail the SUCCEEDED status by several seconds.
  let finalRun = run;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    finalRun = (await apify(`/actor-runs/${run.id}`, token)).data || finalRun;
    if (Number(finalRun.usageTotalUsd || 0) > 0) break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return {
    runId: String(run.id),
    items: Array.isArray(items) ? items : [],
    costUsd: Number(finalRun.usageTotalUsd || 0),
    durationMs: Number(finalRun.stats?.durationMillis || (new Date(finalRun.finishedAt).getTime() - new Date(finalRun.startedAt).getTime()) || 0),
  };
}

function normalizeFacebookUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/" || path.startsWith("/ads/library")) return null;
    return `https://www.facebook.com${path}`;
  } catch {
    return null;
  }
}

function resolveFacebookPage(items: JsonRecord[]) {
  for (const item of items) {
    const candidates = [
      item?.snapshot?.pageProfileUri,
      item?.ad_details?.advertiser?.ad_library_page_info?.page_info?.page_profile_uri,
      item?.pageInfo?.page?.url,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeFacebookUrl(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function flattenAds(items: JsonRecord[]) {
  return items.flatMap(item => Array.isArray(item?.results) ? item.results : [item]);
}

function firstWebsite(page: JsonRecord) {
  const values = [page.website, ...(Array.isArray(page.websites) ? page.websites : [])];
  for (const candidate of values) {
    const value = clean(candidate);
    if (!value || /maps\.google\./i.test(value)) continue;
    try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString(); } catch { /* Try the next value. */ }
  }
  return null;
}

function creativeUrls(ads: JsonRecord[]) {
  const found: Array<{ url: string; description: string }> = [];
  for (const ad of ads) {
    const snapshot = ad?.snapshot || {};
    const description = clean(snapshot?.body?.text || snapshot?.title || ad?.pageName, 500) || "Facebook ad creative";
    const candidates = [
      ...(Array.isArray(snapshot.images) ? snapshot.images.map((image: JsonRecord) => image.originalImageUrl || image.resizedImageUrl) : []),
      ...(Array.isArray(snapshot.cards) ? snapshot.cards.map((card: JsonRecord) => card.originalImageUrl || card.resizedImageUrl || card.videoPreviewImageUrl) : []),
      ...(Array.isArray(snapshot.videos) ? snapshot.videos.map((video: JsonRecord) => video.videoPreviewImageUrl) : []),
    ];
    for (const value of candidates) {
      const url = clean(value);
      if (url) found.push({ url, description });
    }
  }
  return [...new Map(found.map(item => [item.url, item])).values()];
}

async function storeCreative(leadId: string, runId: string, source: { url: string; description: string }, index: number) {
  const pathname = new URL(source.url).pathname;
  const fingerprint = createHash("sha256").update(pathname).digest("hex");
  const existing = await sql`SELECT id FROM lead_images WHERE lead_id=${leadId} AND (source_url=${source.url} OR source_fingerprint=${fingerprint}) LIMIT 1`;
  if (existing[0]) return false;
  const response = await fetch(source.url, { redirect: "follow", headers: { Referer: "https://www.facebook.com/" } });
  if (!response.ok) throw new Error(`Creative download failed (${response.status}).`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error("Creative image exceeds the 12 MB download limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Creative image is empty or too large.");
  const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error(`Unsupported creative image type: ${contentType}.`);
  const optimized = await compressImage(bytes, contentType);
  const now = new Date();
  const key = `leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/apify/${leadId}/${runId}-${index}-${randomUUID()}.${optimized.extension}`;
  const url = await uploadLeadImage({ key, bytes: optimized.bytes, contentType: optimized.contentType });
  await sql`INSERT INTO lead_images (lead_id, url, source_url, source_fingerprint, description, position)
    VALUES (${leadId}, ${url}, ${source.url}, ${fingerprint}, ${source.description}, (SELECT COALESCE(MAX(position), -1) + 1 FROM lead_images WHERE lead_id=${leadId}))
    ON CONFLICT (lead_id, source_fingerprint) WHERE source_fingerprint IS NOT NULL DO NOTHING`;
  return true;
}

export async function queueLeadEnrichment(leadId: string, trigger: Trigger, force = false) {
  const settings = await settingsWithToken();
  if (trigger === "automatic" && !settings.auto_enrich_on_add) return null;
  if (!force) {
    const completed = await sql`SELECT 1 FROM lead_enrichment_runs WHERE lead_id=${leadId} AND status='completed' LIMIT 1`;
    if (completed[0]) return null;
  }
  const rows = await sql`INSERT INTO lead_enrichment_runs (lead_id, token_version, trigger)
    VALUES (${leadId}, ${settings.token_version}, ${trigger})
    ON CONFLICT (lead_id) WHERE status IN ('queued', 'processing') DO NOTHING
    RETURNING id`;
  if (rows[0]?.id) await sql`UPDATE leads SET enrichment_status='queued', updated_at=now() WHERE id=${leadId}`;
  return rows[0]?.id ? String(rows[0].id) : null;
}

export async function processLeadEnrichment(runId: string) {
  const claimed = await sql`UPDATE lead_enrichment_runs SET status='processing', started_at=now(), error_message=NULL
    WHERE id=${runId} AND status='queued' RETURNING lead_id, token_version`;
  if (!claimed[0]) return;
  const leadId = String(claimed[0].lead_id);
  const startedAt = Date.now();
  let costUsd = 0;
  let actorDurationMs = 0;
  const actorRunIds: string[] = [];
  try {
    await sql`UPDATE leads SET enrichment_status='processing', updated_at=now() WHERE id=${leadId}`;
    const settings = await settingsWithToken();
    const monthSpendRows = await sql`SELECT COALESCE(SUM(cost_usd),0)::text AS spend FROM lead_enrichment_runs
      WHERE token_version=${settings.token_version} AND created_at>=date_trunc('month',now()) AND id<>${runId}`;
    if (Number(monthSpendRows[0]?.spend || 0) >= Number(settings.monthly_budget_usd)) {
      await sql`UPDATE lead_enrichment_runs SET status='blocked', error_message='The configured Apify budget has been reached.', duration_ms=${Date.now() - startedAt}, completed_at=now() WHERE id=${runId}`;
      await sql`UPDATE leads SET enrichment_status='blocked', updated_at=now() WHERE id=${leadId}`;
      return;
    }
    const leads = await sql`SELECT ad_url FROM leads WHERE id=${leadId}`;
    if (!leads[0]) throw new Error("Business record no longer exists.");

    const resolveRun = await runActor(ADS_ACTOR_ID, {
      startUrls: [{ url: leads[0].ad_url }], resultsLimit: 1, onlyTotal: false,
      includeAboutPage: false, isDetailsPerAd: false, activeStatus: "active", enrichWithEcommerceData: false,
    }, settings.token);
    actorRunIds.push(resolveRun.runId); costUsd += resolveRun.costUsd; actorDurationMs += resolveRun.durationMs;
    const facebookUrl = resolveFacebookPage(flattenAds(resolveRun.items));
    if (!facebookUrl) throw new Error("The ad was found, but its Facebook business page could not be resolved.");

    const adsRun = await runActor(ADS_ACTOR_ID, {
      startUrls: [{ url: facebookUrl }], resultsLimit: settings.max_ads_per_business, onlyTotal: false,
      includeAboutPage: false, isDetailsPerAd: false, activeStatus: "active", enrichWithEcommerceData: false,
    }, settings.token);
    actorRunIds.push(adsRun.runId); costUsd += adsRun.costUsd; actorDurationMs += adsRun.durationMs;
    const ads = flattenAds(adsRun.items);

    const pageRun = await runActor(PAGE_ACTOR_ID, { startUrls: [{ url: facebookUrl }] }, settings.token);
    actorRunIds.push(pageRun.runId); costUsd += pageRun.costUsd; actorDurationMs += pageRun.durationMs;
    const page = pageRun.items[0] || {};
    const title = clean(page.title || page.pageName || ads[0]?.pageName, 160);
    const email = clean(page.email, 320);
    const phone = clean(page.phone, 80);
    const websiteUrl = firstWebsite(page);
    const pageData = {
      pageId: clean(page.pageId || page.facebookId, 100), pageName: clean(page.pageName, 200),
      title, intro: clean(page.intro, 2_000), address: clean(page.address, 2_000),
      categories: Array.isArray(page.categories) ? page.categories.slice(0, 20) : [],
      websites: Array.isArray(page.websites) ? page.websites.slice(0, 20) : [],
      followers: Number.isFinite(Number(page.followers)) ? Number(page.followers) : null,
      likes: Number.isFinite(Number(page.likes)) ? Number(page.likes) : null,
      creationDate: clean(page.creation_date, 100), messenger: clean(page.messenger, 500),
      scrapedAt: new Date().toISOString(),
    };
    const fieldsUpdated = [
      title && "title", facebookUrl && "facebook_url", email && "email", phone && "phone", websiteUrl && "website_url",
    ].filter(Boolean) as string[];

    await sql`UPDATE leads SET
      title=COALESCE(${title}, NULLIF(BTRIM(title),'')),
      facebook_url=COALESCE(NULLIF(BTRIM(facebook_url),''), ${facebookUrl}),
      email=COALESCE(NULLIF(BTRIM(email),''), ${email}),
      phone=COALESCE(NULLIF(BTRIM(phone),''), ${phone}),
      website_url=COALESCE(NULLIF(BTRIM(website_url),''), ${websiteUrl}),
      website_status=CASE WHEN NULLIF(BTRIM(website_url),'') IS NOT NULL OR ${Boolean(websiteUrl)} THEN 'yes' ELSE website_status END,
      has_website=has_website OR ${Boolean(websiteUrl)}, facebook_page_data=${JSON.stringify(pageData)}::jsonb,
      enriched_at=now(), updated_at=now() WHERE id=${leadId}`;

    const creatives = creativeUrls(ads);
    let saved = 0;
    const imageErrors: string[] = [];
    for (let index = 0; index < creatives.length; index += 1) {
      try { if (await storeCreative(leadId, runId, creatives[index], index)) saved += 1; }
      catch (error) { imageErrors.push(error instanceof Error ? error.message : "Creative could not be stored."); }
    }
    const warning = imageErrors.length ? `${imageErrors.length} creative image(s) could not be stored. ${imageErrors[0]}` : null;
    await sql`UPDATE leads SET workflow_status=CASE
        WHEN workflow_status='research_pending' AND NULLIF(BTRIM(email),'') IS NOT NULL
          AND EXISTS (SELECT 1 FROM lead_images WHERE lead_id=${leadId} AND NULLIF(BTRIM(url),'') IS NOT NULL)
        THEN 'research_completed' ELSE workflow_status END,
      updated_at=now() WHERE id=${leadId}`;
    await sql`UPDATE lead_enrichment_runs SET status='completed', apify_run_ids=${JSON.stringify(actorRunIds)}::jsonb,
      ads_found=${ads.length}, creatives_found=${creatives.length}, creatives_saved=${saved}, fields_updated=${JSON.stringify(fieldsUpdated)}::jsonb,
      cost_usd=${costUsd}, duration_ms=${Date.now() - startedAt}, error_message=${warning}, completed_at=now() WHERE id=${runId}`;
    await sql`UPDATE leads SET enrichment_status='completed', enriched_at=now(), updated_at=now() WHERE id=${leadId}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apify enrichment failed.";
    await sql`UPDATE lead_enrichment_runs SET status='failed', apify_run_ids=${JSON.stringify(actorRunIds)}::jsonb,
      cost_usd=${costUsd || null}, duration_ms=${Date.now() - startedAt || actorDurationMs}, error_message=${message}, completed_at=now() WHERE id=${runId}`;
    await sql`UPDATE leads SET enrichment_status='failed', updated_at=now() WHERE id=${leadId}`;
  }
}

export async function processQueuedEnrichmentRuns(limit = 3) {
  const rows = await sql`SELECT id FROM lead_enrichment_runs WHERE status='queued' ORDER BY created_at ASC LIMIT ${Math.max(1, Math.min(limit, 5))}`;
  await Promise.allSettled(rows.map(row => processLeadEnrichment(String(row.id))));
}
