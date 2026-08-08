import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processQueuedEnrichmentRuns, queueLeadEnrichment } from "@/lib/apify-enrichment";
import { sql } from "@/lib/db";

export const maxDuration = 300;

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [settingsRows, summaryRows, recentRuns] = await Promise.all([
    sql`SELECT token_version, monthly_budget_usd FROM apify_enrichment_settings WHERE id=1`,
    sql`SELECT COUNT(*)::int AS total_runs,
      COUNT(*) FILTER (WHERE status='queued')::int AS queued_runs,
      COUNT(*) FILTER (WHERE status='processing')::int AS processing_runs,
      COUNT(*) FILTER (WHERE status='completed')::int AS completed_runs,
      COUNT(*) FILTER (WHERE status IN ('failed','blocked'))::int AS failed_runs,
      COALESCE(AVG(duration_ms) FILTER (WHERE status='completed'),0)::text AS avg_duration_ms,
      COALESCE(AVG(cost_usd) FILTER (WHERE status='completed'),0)::text AS avg_cost,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('month',now())),0)::text AS month_spend,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('day',now())),0)::text AS today_spend
      FROM lead_enrichment_runs WHERE token_version=(SELECT token_version FROM apify_enrichment_settings WHERE id=1)`,
    sql`SELECT r.id, r.lead_id, l.title AS lead_title, r.trigger, r.status, r.ads_found, r.creatives_found, r.creatives_saved,
      r.cost_usd, r.duration_ms, r.error_message, r.created_at, r.completed_at
      FROM lead_enrichment_runs r JOIN leads l ON l.id=r.lead_id ORDER BY r.created_at DESC LIMIT 30`,
  ]);
  const active = Number(summaryRows[0]?.queued_runs || 0) + Number(summaryRows[0]?.processing_runs || 0);
  if (active) after(() => processQueuedEnrichmentRuns(3));
  return NextResponse.json({ settings: settingsRows[0], summary: summaryRows[0], recentRuns });
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");
  try {
    if (action === "lead") {
      const leadId = String(body.leadId || "");
      if (!/^[0-9a-f-]{36}$/i.test(leadId)) return NextResponse.json({ error: "Choose a valid business." }, { status: 400 });
      const runId = await queueLeadEnrichment(leadId, "manual", true);
      if (!runId) return NextResponse.json({ error: "This business already has an active enrichment run." }, { status: 409 });
      after(() => processQueuedEnrichmentRuns(3));
      return NextResponse.json({ queued: 1, runId });
    }
    if (action === "bulk") {
      const candidates = await sql`SELECT l.id FROM leads l
        WHERE NOT EXISTS (SELECT 1 FROM lead_enrichment_runs r WHERE r.lead_id=l.id AND r.status IN ('completed','queued','processing'))
        ORDER BY l.created_at ASC LIMIT 50`;
      let queued = 0;
      for (const candidate of candidates) {
        if (await queueLeadEnrichment(String(candidate.id), "bulk")) queued += 1;
      }
      if (queued) after(() => processQueuedEnrichmentRuns(3));
      return NextResponse.json({ queued, remainingHint: candidates.length === 50 });
    }
    return NextResponse.json({ error: "Unknown enrichment action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The enrichment run could not be queued." }, { status: 500 });
  }
}
