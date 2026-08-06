import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins, FileText, Gauge, RefreshCw, XCircle } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { DEFAULT_EMAIL_SYSTEM_PROMPT } from "@/lib/email-prompt";
import { getOpenRouterCredits, getVisionModels } from "@/lib/openrouter-models";
import DashboardSidebar from "../sidebar";
import SettingsPanel, { type AISettings } from "./settings-panel";

export const dynamic = "force-dynamic";

type Summary = {
  total_runs: string; completed_runs: string; review_runs: string; failed_runs: string; blocked_runs: string;
  month_spend: string; today_spend: string; total_spend: string; input_tokens: string; output_tokens: string;
  avg_latency_ms: string | null; avg_cost: string | null;
};
type ModelRow = { requested_model: string; runs: string; completed: string; failed: string; spend: string; avg_latency_ms: string | null; input_tokens: string; output_tokens: string };
type RunRow = { id:string; lead_id:string|null; lead_title:string|null; status:string; requested_model:string; actual_model:string|null; cost_usd:string|null; input_tokens:number|null; output_tokens:number|null; latency_ms:number|null; error_message:string|null; created_at:string };
type DraftStatus = { status:string; count:string };

const money = (value: string | number | null | undefined, digits = 4) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
const compact = (value: string | number | null | undefined) => Number(value || 0).toLocaleString("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export default async function AIEmailsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const [settingsRows, summaryRows, modelRows, recentRuns, draftStatuses, models, credits] = await Promise.all([
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
  ]);
  if (!settingsRows[0]) throw new Error("AI email settings are not initialized. Apply database migration 007.");
  const settings = settingsRows[0] as unknown as AISettings;
  const summary = summaryRows[0] as unknown as Summary;
  const monthlyBudget = Number(settings.monthly_budget_usd);
  const monthSpend = Number(summary.month_spend);
  const budgetPercent = monthlyBudget ? Math.min(100, Math.round(monthSpend / monthlyBudget * 100)) : 0;
  const statuses = Object.fromEntries((draftStatuses as DraftStatus[]).map(row => [row.status, Number(row.count)]));
  const accountRemaining = credits.totalCredits !== null && credits.totalUsage !== null ? credits.totalCredits - credits.totalUsage : null;

  return <main className="app-shell ai-shell"><DashboardSidebar user={user} active="ai"/><section className="workspace ai-workspace">
    <header className="topbar ai-topbar"><div><span className="technical">Chalkframe / OpenRouter</span><h1>AI email drafts</h1><p>Model controls, generation health, and verified app-level spending.</p></div><a className="secondary-button" href="https://openrouter.ai/activity" target="_blank" rel="noreferrer">Open OpenRouter <ArrowUpRight size={14}/></a></header>
    <section className="ai-health-strip">
      <article className={process.env.OPENROUTER_API_KEY ? "healthy" : "warning"}><span>{process.env.OPENROUTER_API_KEY ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}API key</span><strong>{process.env.OPENROUTER_API_KEY ? "Configured" : "Missing"}</strong><small>{process.env.OPENROUTER_API_KEY ? "Server-only credential available" : "Add OPENROUTER_API_KEY in Vercel"}</small></article>
      <article><span><Coins size={16}/>This month</span><strong>{money(monthSpend)}</strong><small>{budgetPercent}% of {money(monthlyBudget, 2)} budget</small><i><b style={{ width: `${budgetPercent}%` }}/></i></article>
      <article><span><Gauge size={16}/>Average draft</span><strong>{money(summary.avg_cost)}</strong><small>{summary.avg_latency_ms ? `${(Number(summary.avg_latency_ms) / 1000).toFixed(1)}s average latency` : "No completed generations yet"}</small></article>
      <article><span><Bot size={16}/>OpenRouter balance</span><strong>{accountRemaining === null ? "—" : money(accountRemaining, 2)}</strong><small>{credits.error || (credits.configured ? `${money(credits.totalUsage, 2)} account usage` : "API key required")}</small></article>
    </section>
    <section className="ai-metric-grid">
      <article><FileText size={17}/><span>Successful emails</span><strong>{Number(summary.completed_runs).toLocaleString("en-IN")}</strong><small>{statuses.queued || 0} queued · {statuses.processing || 0} processing</small></article>
      <article><RefreshCw size={17}/><span>Needs redesign review</span><strong>{Number(summary.review_runs).toLocaleString("en-IN")}</strong><small>The model found no genuine improvement</small></article>
      <article><XCircle size={17}/><span>Failed or blocked</span><strong>{(Number(summary.failed_runs) + Number(summary.blocked_runs)).toLocaleString("en-IN")}</strong><small>{summary.failed_runs} failed · {summary.blocked_runs} cost/config blocked</small></article>
      <article><Clock3 size={17}/><span>Tokens processed</span><strong>{compact(Number(summary.input_tokens) + Number(summary.output_tokens))}</strong><small>{compact(summary.input_tokens)} input · {compact(summary.output_tokens)} output</small></article>
    </section>
    <SettingsPanel initial={settings} models={models} defaultPrompt={DEFAULT_EMAIL_SYSTEM_PROMPT}/>
    <div className="ai-data-grid"><section className="ai-model-table"><header><div><span className="technical">Model performance</span><h2>Cost and reliability</h2></div><small>{money(summary.today_spend)} spent today</small></header>{modelRows.length?<div className="ai-table"><div className="ai-table-row labels"><span>Model</span><span>Runs</span><span>Success</span><span>Spend</span><span>Latency</span></div>{(modelRows as ModelRow[]).map(row => { const completed=Number(row.completed); const runs=Number(row.runs); return <div className="ai-table-row" key={row.requested_model}><strong title={row.requested_model}>{row.requested_model}</strong><span>{runs}</span><span>{runs ? Math.round(completed / runs * 100) : 0}%</span><span>{money(row.spend)}</span><span>{row.avg_latency_ms ? `${(Number(row.avg_latency_ms)/1000).toFixed(1)}s` : "—"}</span></div>})}</div>:<div className="ai-empty"><Bot size={24}/><strong>No model runs yet</strong><span>Metrics appear after the first collage email is generated.</span></div>}</section>
      <section className="ai-run-list"><header><div><span className="technical">Audit trail</span><h2>Recent generations</h2></div><small>{summary.total_runs} total</small></header>{recentRuns.length?<div>{(recentRuns as RunRow[]).map(run => <article key={run.id}><i className={`run-dot ${run.status}`}/><div><strong>{run.lead_title || "Deleted business"}</strong><span>{run.actual_model || run.requested_model}</span>{run.error_message&&<small title={run.error_message}>{run.error_message}</small>}</div><aside><b>{run.cost_usd === null ? "—" : money(run.cost_usd)}</b><span>{new Date(run.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>{run.lead_id&&<Link href={`/dashboard/leads/${run.lead_id}`}>Open</Link>}</aside></article>)}</div>:<div className="ai-empty"><FileText size={24}/><strong>No generation history</strong></div>}</section>
    </div>
  </section></main>;
}
