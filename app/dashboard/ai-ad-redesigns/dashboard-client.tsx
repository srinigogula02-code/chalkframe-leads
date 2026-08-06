"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins, FileText, Gauge, Image as ImageIcon, RefreshCw, Sparkles, Zap, XCircle } from "lucide-react";
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
  trigger: string | null;
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
  const router = useRouter();
  const [currency, setCurrency] = useState<CurrencyCode>("INR");
  const hasProcessing = recentRuns.some(r => r.status === "processing");

  // Auto-refresh dashboard when runs are in processing state
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasProcessing, router]);

  const avgLatencySec = summary.avg_latency_ms ? (Number(summary.avg_latency_ms) / 1000).toFixed(1) : "—";
  const activeModel = models.find(m => m.id === settings.model);

  return (
    <section className="workspace ai-workspace">
      <header className="topbar ai-topbar">
        <div>
          <span className="technical">Chalkframe / AI Redesign Engine</span>
          <h1>AI Ad Creative Redesigns</h1>
          <p>Configure OpenRouter models, budgets, system prompts & view generation audit logs.</p>
        </div>
        <div className="topbar-actions">
          <div className="currency-toggle-card">
            <span className="currency-label">Currency:</span>
            <div className="currency-pill">
              <button
                type="button"
                className={currency === "INR" ? "active" : ""}
                onClick={() => setCurrency("INR")}
              >
                ₹ INR
              </button>
              <button
                type="button"
                className={currency === "USD" ? "active" : ""}
                onClick={() => setCurrency("USD")}
              >
                $ USD
              </button>
            </div>
          </div>
          <button type="button" className="secondary-button" onClick={() => router.refresh()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>

      <section className="ai-health-strip">
        <article className={apiKeyConfigured ? "healthy" : "warning"}>
          <span>
            <Coins size={14} /> OpenRouter Connection
          </span>
          <strong>{apiKeyConfigured ? "Connected" : "Key missing"}</strong>
          <small>
            {credits.totalCredits !== null
              ? `Balance: $${credits.totalCredits.toFixed(2)} USD`
              : credits.error || "Valid OpenRouter API key configured."}
          </small>
        </article>

        <article className="healthy">
          <span>
            <Gauge size={14} /> Month Spend Limit
          </span>
          <strong>{formatCurrency(summary.month_spend, currency, 2, exchangeRate)}</strong>
          <small>Monthly Budget: {formatCurrency(settings.monthly_budget_usd, currency, 2, exchangeRate)}</small>
          <i>
            <b
              style={{
                width: `${Math.min(100, Math.round((Number(summary.month_spend) / Math.max(0.01, Number(settings.monthly_budget_usd))) * 100))}%`,
              }}
            />
          </i>
        </article>

        <article className="healthy">
          <span>
            <Bot size={14} /> Active Model
          </span>
          <strong title={settings.model}>{activeModel?.name || settings.model}</strong>
          <small>
            {activeModel ? `${activeModel.id} · Image Generator` : "Configured via OpenRouter settings"}
          </small>
        </article>

        <article className="healthy">
          <span>
            <Clock3 size={14} /> Performance
          </span>
          <strong>{avgLatencySec}s avg</strong>
          <small>Per-image limit: {formatCurrency(settings.max_cost_usd, currency, 3, exchangeRate)}</small>
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
              <span className="technical">Audit trail & Logs</span>
              <h2>Recent redesign generations</h2>
            </div>
            <small>{summary.total_runs} total runs</small>
          </header>
          {recentRuns.length ? (
            <div className="run-card-list">
              {recentRuns.map(run => {
                const isProcessing = run.status === "processing";
                const isCompleted = run.status === "completed";
                const isFailed = run.status === "failed";
                const isBlocked = run.status === "blocked";

                return (
                  <div key={run.id} className={`ad-redesign-run-card ${run.status}`}>
                    {/* Header Row */}
                    <div className="run-card-header">
                      <div className="run-header-left">
                        <span className="run-header-title">{run.lead_title || "Business record"}</span>
                        <code className="run-model-code">{run.actual_model || run.requested_model}</code>
                        {isProcessing && (
                          <span className="run-status-badge processing">
                            <Clock3 size={12} className="spin-icon" /> Processing…
                          </span>
                        )}
                        {isCompleted && (
                          <span className="run-status-badge completed">
                            <CheckCircle2 size={12} /> Completed & Saved
                          </span>
                        )}
                        {isFailed && (
                          <span className="run-status-badge failed">
                            <XCircle size={12} /> Generation Failed
                          </span>
                        )}
                        {isBlocked && (
                          <span className="run-status-badge blocked">
                            <AlertTriangle size={12} /> Budget Blocked
                          </span>
                        )}
                        <span className="run-trigger-pill">
                          {run.trigger === "automatic" ? (
                            <>
                              <Zap size={11} /> Auto-Redesign
                            </>
                          ) : (
                            <>
                              <Sparkles size={11} /> Manual Action
                            </>
                          )}
                        </span>
                      </div>
                      <span className="run-time-stamp">
                        {new Date(run.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>

                    {/* Main Body Row */}
                    <div className="run-body">
                      <div className="run-details">
                        <div className="run-meta-row">
                          {run.latency_ms !== null && <span>⏱️ {(run.latency_ms / 1000).toFixed(1)}s</span>}
                          {run.cost_usd !== null && <span>💰 {formatCurrency(run.cost_usd, currency, 4, exchangeRate)}</span>}
                          {run.lead_id && (
                            <Link href={`/dashboard/leads/${run.lead_id}`} className="run-lead-link">
                              Open Business Workspace <ArrowUpRight size={12} />
                            </Link>
                          )}
                        </div>
                      </div>

                      {/* Side-by-Side Images */}
                      <div className="run-images-box">
                        {run.source_image_url && (
                          <div className="run-img-wrapper">
                            <span className="img-tag original">Original Ad</span>
                            <a href={run.source_image_url} target="_blank" rel="noreferrer" title="Original Creative">
                              <img src={run.source_image_url} alt="Original Ad Creative" loading="lazy" />
                            </a>
                          </div>
                        )}
                        {run.redesign_image_url && (
                          <div className="run-img-wrapper">
                            <span className="img-tag redesign">AI Redesign</span>
                            <a href={run.redesign_image_url} target="_blank" rel="noreferrer" title="AI Redesign Creative">
                              <img src={run.redesign_image_url} alt="AI Redesign Creative" loading="lazy" />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Diagnostic Error Box */}
                    {(run.error_message || isFailed || isBlocked) && (
                      <div className={`run-error-box ${isBlocked ? "blocked" : ""}`}>
                        <AlertTriangle size={16} />
                        <div>
                          <strong>{isBlocked ? "Budget Limit Enforced" : "Diagnostic Error Log"}</strong>
                          <p>{run.error_message || "The redesign generation attempt failed before completion."}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ai-empty">
              <FileText size={24} />
              <strong>No ad redesign history</strong>
              <span>Generations and audit logs will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
