import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DEFAULT_AD_REDESIGN_SYSTEM_PROMPT } from "@/lib/ad-redesign-prompt";
import { getUsdToInrRate } from "@/lib/currency";
import { sql } from "@/lib/db";
import { getImageGenerationModels, getOpenRouterCredits } from "@/lib/openrouter-models";
import DashboardSidebar from "../sidebar";
import AdRedesignDashboardClient, {
  type AdRedesignModelRow,
  type AdRedesignRunRow,
  type AdRedesignSummary,
} from "./dashboard-client";
import type { AIAdRedesignSettings } from "./settings-panel";

export const dynamic = "force-dynamic";

export default async function AIAdRedesignsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const [settingsRows, summaryRows, modelRows, recentRuns, models, credits, exchangeRate] = await Promise.all([
    sql`SELECT enabled, auto_redesign_on_ad_add, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override, aspect_ratio, quality, creative_guidance, updated_at FROM ai_ad_redesign_settings WHERE id=1`,
    sql`SELECT COUNT(*)::text AS total_runs,
      COUNT(*) FILTER (WHERE status='completed')::text AS completed_runs,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed_runs,
      COUNT(*) FILTER (WHERE status='blocked')::text AS blocked_runs,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('month',now())),0)::text AS month_spend,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('day',now())),0)::text AS today_spend,
      COALESCE(SUM(cost_usd),0)::text AS total_spend,
      AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::text AS avg_latency_ms,
      AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)::text AS avg_cost
      FROM lead_ad_redesign_runs`,
    sql`SELECT requested_model, COUNT(*)::text AS runs, COUNT(*) FILTER (WHERE status='completed')::text AS completed,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed, COALESCE(SUM(cost_usd),0)::text AS spend,
      AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::text AS avg_latency_ms
      FROM lead_ad_redesign_runs GROUP BY requested_model ORDER BY SUM(cost_usd) DESC NULLS LAST, COUNT(*) DESC LIMIT 12`,
    sql`SELECT id, lead_id, lead_title, trigger, status, requested_model, actual_model, source_image_url, redesign_image_url, cost_usd, latency_ms, error_message, created_at
      FROM lead_ad_redesign_runs ORDER BY created_at DESC LIMIT 30`,
    getImageGenerationModels(),
    getOpenRouterCredits(),
    getUsdToInrRate(),
  ]);

  if (!settingsRows[0]) throw new Error("AI ad redesign settings are not initialized. Apply database migration 008.");
  const settings = settingsRows[0] as unknown as AIAdRedesignSettings;
  const summary = summaryRows[0] as unknown as AdRedesignSummary;
  const apiKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());

  return (
    <main className="app-shell ai-shell">
      <DashboardSidebar user={user} active="ai_ad_redesigns" />
      <AdRedesignDashboardClient
        apiKeyConfigured={apiKeyConfigured}
        settings={settings}
        summary={summary}
        modelRows={modelRows as unknown as AdRedesignModelRow[]}
        recentRuns={recentRuns as unknown as AdRedesignRunRow[]}
        models={models}
        credits={credits}
        defaultPrompt={DEFAULT_AD_REDESIGN_SYSTEM_PROMPT}
        exchangeRate={exchangeRate}
      />
    </main>
  );
}
