import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getUsdToInrRate } from "@/lib/currency";
import { sql } from "@/lib/db";
import { DEFAULT_EMAIL_SYSTEM_PROMPT } from "@/lib/email-prompt";
import { getOpenRouterCredits, getVisionModels } from "@/lib/openrouter-models";
import DashboardSidebar from "../sidebar";
import AIEmailsDashboardClient, {
  type ModelRow,
  type RunRow,
  type Summary,
} from "./dashboard-client";
import type { AISettings } from "./settings-panel";

export const dynamic = "force-dynamic";

type DraftStatus = { status: string; count: string };

export default async function AIEmailsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const [settingsRows, summaryRows, modelRows, recentRuns, draftStatuses, models, credits, exchangeRate] = await Promise.all([
    sql`SELECT enabled, model, fallback_model, temperature, max_output_tokens, max_cost_usd, monthly_budget_usd, system_prompt_override, updated_at FROM ai_settings WHERE id=1`,
    sql`SELECT COUNT(*)::text AS total_runs,
      COUNT(*) FILTER (WHERE status='completed')::text AS completed_runs,
      COUNT(*) FILTER (WHERE status='needs_review')::text AS review_runs,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed_runs,
      COUNT(*) FILTER (WHERE status='blocked')::text AS blocked_runs,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('month',now())),0)::text AS month_spend,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at>=date_trunc('day',now())),0)::text AS today_spend,
      COALESCE(SUM(cost_usd),0)::text AS total_spend,
      COALESCE(SUM(input_tokens),0)::text AS input_tokens,
      COALESCE(SUM(output_tokens),0)::text AS output_tokens,
      AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::text AS avg_latency_ms,
      AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)::text AS avg_cost
      FROM ai_generation_runs`,
    sql`SELECT requested_model, COUNT(*)::text AS runs, COUNT(*) FILTER (WHERE status='completed')::text AS completed,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed, COALESCE(SUM(cost_usd),0)::text AS spend,
      AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::text AS avg_latency_ms,
      COALESCE(SUM(input_tokens),0)::text AS input_tokens, COALESCE(SUM(output_tokens),0)::text AS output_tokens
      FROM ai_generation_runs GROUP BY requested_model ORDER BY SUM(cost_usd) DESC NULLS LAST, COUNT(*) DESC LIMIT 12`,
    sql`SELECT id, lead_id, lead_title, status, requested_model, actual_model, cost_usd, input_tokens, output_tokens, latency_ms, error_message, created_at
      FROM ai_generation_runs ORDER BY created_at DESC LIMIT 30`,
    sql`SELECT status, COUNT(*)::text AS count FROM lead_email_drafts GROUP BY status`,
    getVisionModels(),
    getOpenRouterCredits(),
    getUsdToInrRate(),
  ]);

  if (!settingsRows[0]) throw new Error("AI email settings are not initialized. Apply database migration 007.");
  const settings = settingsRows[0] as unknown as AISettings;
  const summary = summaryRows[0] as unknown as Summary;
  const statuses = Object.fromEntries((draftStatuses as DraftStatus[]).map(row => [row.status, Number(row.count)]));
  const apiKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());

  return (
    <main className="app-shell ai-shell">
      <DashboardSidebar user={user} active="ai" />
      <AIEmailsDashboardClient
        apiKeyConfigured={apiKeyConfigured}
        settings={settings}
        summary={summary}
        modelRows={modelRows as unknown as ModelRow[]}
        recentRuns={recentRuns as unknown as RunRow[]}
        statuses={statuses}
        models={models}
        credits={credits}
        defaultPrompt={DEFAULT_EMAIL_SYSTEM_PROMPT}
        exchangeRate={exchangeRate}
      />
    </main>
  );
}
