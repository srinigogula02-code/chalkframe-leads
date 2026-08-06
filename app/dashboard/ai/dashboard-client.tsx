"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins, FileText, Gauge, RefreshCw, XCircle } from "lucide-react";
import { CurrencyCode, DEFAULT_USD_TO_INR, formatCurrency } from "@/lib/currency";
import type { OpenRouterModelOption } from "@/lib/openrouter-models";
import SettingsPanel, { type AISettings } from "./settings-panel";

export type Summary = {
  total_runs: string;
  completed_runs: string;
  review_runs: string;
  failed_runs: string;
  blocked_runs: string;
  month_spend: string;
  today_spend: string;
  total_spend: string;
  input_tokens: string;
  output_tokens: string;
  avg_latency_ms: string | null;
  avg_cost: string | null;
};

export type ModelRow = {
  requested_model: string;
  runs: string;
  completed: string;
  failed: string;
  spend: string;
  avg_latency_ms: string | null;
  input_tokens: string;
  output_tokens: string;
};

export type RunRow = {
  id: string;
  lead_id: string | null;
  lead_title: string | null;
  status: string;
  requested_model: string;
  actual_model: string | null;
  cost_usd: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
};

const compact = (value: string | number | null | undefined) =>
  Number(value || 0).toLocaleString("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export default function AIEmailsDashboardClient({
  apiKeyConfigured,
  settings,
  summary,
  modelRows,
  recentRuns,
  statuses,
  models,
  credits,
  defaultPrompt,
  exchangeRate = DEFAULT_USD_TO_INR,
}: {
  apiKeyConfigured: boolean;
  settings: AISettings;
  summary: Summary;
  modelRows: ModelRow[];
  recentRuns: RunRow[];
  statuses: Record<string, number>;
  models: OpenRouterModelOption[];
  credits: { configured: boolean; totalCredits: number | null; totalUsage: number | null; error: string | null };
  defaultPrompt: string;
  exchangeRate?: number;
}) {
  const [currency, setCurrency] = useState<CurrencyCode>("INR");

  useEffect(() => {
    const saved = localStorage.getItem("chalkframe_dashboard_currency");
    if (saved === "USD" || saved === "INR") {
      setCurrency(saved);
    }
  }, []);

  function changeCurrency(newCode: CurrencyCode) {
    setCurrency(newCode);
    localStorage.setItem("chalkframe_dashboard_currency", newCode);
  }

  const monthlyBudget = Number(settings.monthly_budget_usd);
  const monthSpend = Number(summary.month_spend);
  const budgetPercent = monthlyBudget ? Math.min(100, Math.round((monthSpend / monthlyBudget) * 100)) : 0;
  const accountRemaining =
    credits.totalCredits !== null && credits.totalUsage !== null ? credits.totalCredits - credits.totalUsage : null;

  return (
    <section className="workspace ai-workspace">
      <header className="topbar ai-topbar">
        <div>
          <span className="technical">Chalkframe / OpenRouter</span>
          <h1>AI email drafts</h1>
          <p>
            Model controls, generation health, and verified app-level spending (Exchange rate: 1 USD = ₹
            {exchangeRate.toFixed(2)}).
          </p>
        </div>
        <div className="topbar-actions">
          <div className="currency-toggle-card">
            <span className="currency-label">Currency</span>
            <div className="currency-pill">
              <button
                type="button"
                className={currency === "INR" ? "active" : ""}
                onClick={() => changeCurrency("INR")}
              >
                ₹ INR
              </button>
              <button
                type="button"
                className={currency === "USD" ? "active" : ""}
                onClick={() => changeCurrency("USD")}
              >
                $ USD
              </button>
            </div>
          </div>
          <a className="secondary-button" href="https://openrouter.ai/activity" target="_blank" rel="noreferrer">
            Open OpenRouter <ArrowUpRight size={14} />
          </a>
        </div>
      </header>

      <section className="ai-health-strip">
        <article className={apiKeyConfigured ? "healthy" : "warning"}>
          <span>
            {apiKeyConfigured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}API key
          </span>
          <strong>{apiKeyConfigured ? "Configured" : "Missing"}</strong>
          <small>{apiKeyConfigured ? "Server-only credential available" : "Add OPENROUTER_API_KEY in .env.local / Vercel"}</small>
        </article>

        <article>
          <span>
            <Coins size={16} />This month
          </span>
          <strong>{formatCurrency(monthSpend, currency, 2, exchangeRate)}</strong>
          <small>
            {budgetPercent}% of {formatCurrency(monthlyBudget, currency, 2, exchangeRate)} budget
          </small>
          <i>
            <b style={{ width: `${budgetPercent}%` }} />
          </i>
        </article>

        <article>
          <span>
            <Gauge size={16} />Average draft
          </span>
          <strong>{formatCurrency(summary.avg_cost, currency, 4, exchangeRate)}</strong>
          <small>
            {summary.avg_latency_ms
              ? `${(Number(summary.avg_latency_ms) / 1000).toFixed(1)}s average latency`
              : "No completed generations yet"}
          </small>
        </article>

        <article>
          <span>
            <Bot size={16} />OpenRouter balance
          </span>
          <strong>{accountRemaining === null ? "—" : formatCurrency(accountRemaining, currency, 2, exchangeRate)}</strong>
          <small>
            {credits.error ||
              (credits.configured
                ? `${formatCurrency(credits.totalUsage, currency, 2, exchangeRate)} account usage`
                : "API key required")}
          </small>
        </article>
      </section>

      <section className="ai-metric-grid">
        <article>
          <FileText size={17} />
          <span>Successful emails</span>
          <strong>{Number(summary.completed_runs).toLocaleString("en-IN")}</strong>
          <small>
            {statuses.queued || 0} queued · {statuses.processing || 0} processing
          </small>
        </article>
        <article>
          <RefreshCw size={17} />
          <span>Needs redesign review</span>
          <strong>{Number(summary.review_runs).toLocaleString("en-IN")}</strong>
          <small>The model found no genuine improvement</small>
        </article>
        <article>
          <XCircle size={17} />
          <span>Failed or blocked</span>
          <strong>{(Number(summary.failed_runs) + Number(summary.blocked_runs)).toLocaleString("en-IN")}</strong>
          <small>
            {summary.failed_runs} failed · {summary.blocked_runs} cost/config blocked
          </small>
        </article>
        <article>
          <Clock3 size={17} />
          <span>Tokens processed</span>
          <strong>{compact(Number(summary.input_tokens) + Number(summary.output_tokens))}</strong>
          <small>
            {compact(summary.input_tokens)} input · {compact(summary.output_tokens)} output
          </small>
        </article>
      </section>

      <SettingsPanel
        initial={settings}
        models={models}
        defaultPrompt={defaultPrompt}
        currency={currency}
        exchangeRate={exchangeRate}
      />

      <div className="ai-data-grid">
        <section className="ai-model-table">
          <header>
            <div>
              <span className="technical">Model performance</span>
              <h2>Cost and reliability</h2>
            </div>
            <small>{formatCurrency(summary.today_spend, currency, 2, exchangeRate)} spent today</small>
          </header>
          {modelRows.length ? (
            <div className="ai-table">
              <div className="ai-table-row labels">
                <span>Model</span>
                <span>Runs</span>
                <span>Success</span>
                <span>Spend</span>
                <span>Latency</span>
              </div>
              {modelRows.map(row => {
                const completed = Number(row.completed);
                const runs = Number(row.runs);
                return (
                  <div className="ai-table-row" key={row.requested_model}>
                    <strong title={row.requested_model}>{row.requested_model}</strong>
                    <span>{runs}</span>
                    <span>{runs ? Math.round((completed / runs) * 100) : 0}%</span>
                    <span>{formatCurrency(row.spend, currency, 4, exchangeRate)}</span>
                    <span>{row.avg_latency_ms ? `${(Number(row.avg_latency_ms) / 1000).toFixed(1)}s` : "—"}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ai-empty">
              <Bot size={24} />
              <strong>No model runs yet</strong>
              <span>Metrics appear after the first collage email is generated.</span>
            </div>
          )}
        </section>

        <section className="ai-run-list">
          <header>
            <div>
              <span className="technical">Audit trail</span>
              <h2>Recent generations</h2>
            </div>
            <small>{summary.total_runs} total</small>
          </header>
          {recentRuns.length ? (
            <div>
              {recentRuns.map(run => (
                <article key={run.id}>
                  <i className={`run-dot ${run.status}`} />
                  <div>
                    <strong>{run.lead_title || "Deleted business"}</strong>
                    <span>{run.actual_model || run.requested_model}</span>
                    {run.error_message && <small title={run.error_message}>{run.error_message}</small>}
                  </div>
                  <aside>
                    <b>{run.cost_usd === null ? "—" : formatCurrency(run.cost_usd, currency, 4, exchangeRate)}</b>
                    <span>
                      {new Date(run.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {run.lead_id && <Link href={`/dashboard/leads/${run.lead_id}`}>Open</Link>}
                  </aside>
                </article>
              ))}
            </div>
          ) : (
            <div className="ai-empty">
              <FileText size={24} />
              <strong>No generation history</strong>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
