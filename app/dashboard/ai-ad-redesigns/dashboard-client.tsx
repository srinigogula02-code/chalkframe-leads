"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins, FileText, Gauge, Image as ImageIcon, Sparkles, XCircle } from "lucide-react";
import { CurrencyCode, DEFAULT_USD_TO_INR, formatCurrency } from "@/lib/currency";
import type { OpenRouterModelOption } from "@/lib/openrouter-models";
import AdRedesignSettingsPanel, { type AIAdRedesignSettings } from "./settings-panel";

export type AdRedesignSummary = {
  total_runs: string;
  completed_runs: string;
  failed_runs: string;
  blocked_runs: string;
  month_spend: string;
  today_spend: string;
  total_spend: string;
  avg_latency_ms: string | null;
  avg_cost: string | null;
};

export type AdRedesignModelRow = {
  requested_model: string;
  runs: string;
  completed: string;
  failed: string;
  spend: string;
  avg_latency_ms: string | null;
};

export type AdRedesignRunRow = {
  id: string;
  lead_id: string | null;
  lead_title: string | null;
  status: string;
  requested_model: string;
  actual_model: string | null;
  source_image_url: string;
  redesign_image_url: string | null;
  cost_usd: string | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
};

export default function AdRedesignDashboardClient({
  apiKeyConfigured,
  settings,
  summary,
  modelRows,
  recentRuns,
  models,
  credits,
  defaultPrompt,
  exchangeRate = DEFAULT_USD_TO_INR,
}: {
  apiKeyConfigured: boolean;
  settings: AIAdRedesignSettings;
  summary: AdRedesignSummary;
  modelRows: AdRedesignModelRow[];
  recentRuns: AdRedesignRunRow[];
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
          <span className="technical">Chalkframe / OpenRouter Multimodal</span>
          <h1>AI Ad Creative Redesigns</h1>
          <p>
            Performance marketing ad creative redesigns, model controls, and auto-generation settings (1 USD = ₹
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
            <Gauge size={16} />Average redesign
          </span>
          <strong>{formatCurrency(summary.avg_cost, currency, 4, exchangeRate)}</strong>
          <small>
            {summary.avg_latency_ms
              ? `${(Number(summary.avg_latency_ms) / 1000).toFixed(1)}s average generation`
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
          <Sparkles size={17} />
          <span>Completed redesigns</span>
          <strong>{Number(summary.completed_runs).toLocaleString("en-IN")}</strong>
          <small>Performance-marketing creative outputs</small>
        </article>
        <article>
          <ImageIcon size={17} />
          <span>Auto-Redesign mode</span>
          <strong>{settings.auto_redesign_on_ad_add ? "ENABLED" : "DISABLED"}</strong>
          <small>{settings.auto_redesign_on_ad_add ? "Automatically runs when ad creative is added" : "Default manual trigger mode"}</small>
        </article>
        <article>
          <XCircle size={17} />
          <span>Failed or blocked</span>
          <strong>{(Number(summary.failed_runs) + Number(summary.blocked_runs)).toLocaleString("en-IN")}</strong>
          <small>
            {summary.failed_runs} failed · {summary.blocked_runs} budget blocked
          </small>
        </article>
        <article>
          <Clock3 size={17} />
          <span>Total redesign runs</span>
          <strong>{Number(summary.total_runs).toLocaleString("en-IN")}</strong>
          <small>Generations executed</small>
        </article>
      </section>

      <AdRedesignSettingsPanel
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
              <span>Metrics appear after the first AI ad creative redesign is generated.</span>
            </div>
          )}
        </section>

        <section className="ai-run-list">
          <header>
            <div>
              <span className="technical">Audit trail</span>
              <h2>Recent redesign generations</h2>
            </div>
            <small>{summary.total_runs} total</small>
          </header>
          {recentRuns.length ? (
            <div>
              {recentRuns.map(run => (
                <article key={run.id} className="ad-redesign-run-card">
                  <i className={`run-dot ${run.status}`} />
                  <div>
                    <strong>{run.lead_title || "Deleted business"}</strong>
                    <span>{run.actual_model || run.requested_model}</span>
                    <div className="run-image-comparison">
                      {run.source_image_url && (
                        <a href={run.source_image_url} target="_blank" rel="noreferrer" title="Original Creative">
                          <img src={run.source_image_url} alt="Original" />
                        </a>
                      )}
                      {run.redesign_image_url && (
                        <a href={run.redesign_image_url} target="_blank" rel="noreferrer" title="AI Redesign Creative">
                          <img src={run.redesign_image_url} alt="Redesign" />
                        </a>
                      )}
                    </div>
                    {run.error_message && <small title={run.error_message}>{run.error_message}</small>}
                  </div>
                  <aside>
                    <b>{run.cost_usd === null ? "—" : formatCurrency(run.cost_usd, currency, 4, exchangeRate)}</b>
                    <span>
                      {new Date(run.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {run.lead_id && <Link href={`/dashboard/leads/${run.lead_id}`}>Open Business</Link>}
                  </aside>
                </article>
              ))}
            </div>
          ) : (
            <div className="ai-empty">
              <FileText size={24} />
              <strong>No ad redesign history</strong>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
