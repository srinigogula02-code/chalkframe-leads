import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import DashboardSidebar from "../sidebar";
import ApifyDashboardClient, { type ApifyRunRow, type ApifySettings, type ApifySummary } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function ApifyPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const [settingsRows, summaryRows, recentRuns, existingRows] = await Promise.all([
    sql`SELECT auto_enrich_on_add, monthly_budget_usd, max_ads_per_business, api_token_hint,
      api_token_ciphertext IS NOT NULL AS api_key_configured, updated_at FROM apify_enrichment_settings WHERE id=1`,
    sql`SELECT COUNT(*)::text AS total_runs,
      COUNT(*) FILTER (WHERE status='queued')::text AS queued_runs,
      COUNT(*) FILTER (WHERE status='processing')::text AS processing_runs,
      COUNT(*) FILTER (WHERE status='completed')::text AS completed_runs,
      COUNT(*) FILTER (WHERE status IN ('failed','blocked'))::text AS failed_runs,
      COALESCE(AVG(duration_ms) FILTER (WHERE status='completed'),0)::text AS avg_duration_ms,
      COALESCE(AVG(cost_usd) FILTER (WHERE status='completed'),0)::text AS avg_cost,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('month',now())),0)::text AS month_spend,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('day',now())),0)::text AS today_spend
      FROM lead_enrichment_runs WHERE token_version=(SELECT token_version FROM apify_enrichment_settings WHERE id=1)`,
    sql`SELECT r.id, r.lead_id, l.title AS lead_title, r.trigger, r.status, r.ads_found, r.creatives_found, r.creatives_saved,
      r.cost_usd, r.duration_ms, r.error_message, r.created_at, r.completed_at
      FROM lead_enrichment_runs r JOIN leads l ON l.id=r.lead_id ORDER BY r.created_at DESC LIMIT 30`,
    sql`SELECT COUNT(*)::text AS count FROM leads l WHERE NOT EXISTS
      (SELECT 1 FROM lead_enrichment_runs r WHERE r.lead_id=l.id AND r.status IN ('completed','queued','processing'))`,
  ]);
  if (!settingsRows[0]) throw new Error("Apify settings are not initialized. Apply database migration 012.");
  return <main className="app-shell ai-shell">
    <DashboardSidebar user={user} active="apify" />
    <ApifyDashboardClient
      initialSettings={settingsRows[0] as unknown as ApifySettings}
      initialSummary={summaryRows[0] as unknown as ApifySummary}
      initialRuns={recentRuns as unknown as ApifyRunRow[]}
      existingCount={Number(existingRows[0]?.count || 0)}
    />
  </main>;
}
