"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Coins, Database, KeyRound, Play, RefreshCw, Save, XCircle, Zap } from "lucide-react";

export type ApifySettings = {
  auto_enrich_on_add: boolean;
  monthly_budget_usd: string | number;
  max_ads_per_business: number;
  api_token_hint: string | null;
  api_key_configured: boolean;
  updated_at: string;
};
export type ApifySummary = {
  total_runs: string | number; queued_runs: string | number; processing_runs: string | number;
  completed_runs: string | number; failed_runs: string | number; avg_duration_ms: string | number;
  avg_cost: string | number; month_spend: string | number; today_spend?: string | number;
};
export type ApifyRunRow = {
  id: string; lead_id: string; lead_title: string | null; trigger: string; status: string;
  ads_found: number; creatives_found: number; creatives_saved: number; cost_usd: string | null;
  duration_ms: number | null; error_message: string | null; created_at: string; completed_at: string | null;
};

const money = (value: unknown, digits = 4) => `$${Number(value || 0).toFixed(digits)}`;

export default function ApifyDashboardClient({ initialSettings, initialSummary, initialRuns, existingCount }: {
  initialSettings: ApifySettings; initialSummary: ApifySummary; initialRuns: ApifyRunRow[]; existingCount: number;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [summary, setSummary] = useState(initialSummary);
  const [runs, setRuns] = useState(initialRuns);
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hasActive = Number(summary.queued_runs) + Number(summary.processing_runs) > 0;
  const budget = Number(settings.monthly_budget_usd || 5);
  const spent = Number(summary.month_spend || 0);
  const budgetPercent = Math.min(100, Math.round((spent / Math.max(0.01, budget)) * 100));

  useEffect(() => {
    if (!hasActive) return;
    const refresh = async () => {
      const response = await fetch("/api/admin/apify/runs", { cache: "no-store" });
      const body = await response.json();
      if (response.ok) { setSummary(body.summary); setRuns(body.recentRuns); }
    };
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  async function saveSettings() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/apify/settings", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiToken, autoEnrichOnAdd: settings.auto_enrich_on_add,
          monthlyBudgetUsd: settings.monthly_budget_usd, maxAdsPerBusiness: settings.max_ads_per_business }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Settings could not be saved.");
      setSettings(current => ({ ...current, ...body.settings })); setApiToken("");
      setMessage(body.account ? `API key verified for ${body.account} and settings saved.` : "Apify settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be saved."); }
    finally { setSaving(false); }
  }

  async function queue(action: "bulk" | "lead", leadId?: string) {
    setBulkRunning(action === "bulk"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/apify/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, leadId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Businesses could not be queued.");
      setMessage(action === "bulk" ? `${body.queued} existing business${body.queued === 1 ? "" : "es"} queued for enrichment.` : "Business queued for a fresh scrape.");
      setSummary(current => ({ ...current, queued_runs: Number(current.queued_runs) + Number(body.queued || 1) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Businesses could not be queued."); }
    finally { setBulkRunning(false); }
  }

  return <section className="workspace ai-workspace apify-workspace">
    <header className="topbar ai-topbar"><div><span className="technical">Chalkframe / Apify enrichment</span><h1>Business data automation</h1><p>Scrape Facebook contact details and active ad creatives, then preserve the images in R2.</p></div>
      <button className="secondary-button" onClick={() => location.reload()}><RefreshCw size={14}/>Refresh</button></header>

    <section className="ai-health-strip">
      <article className={settings.api_key_configured ? "healthy" : "warning"}><span><KeyRound size={16}/>API key</span><strong>{settings.api_key_configured ? `•••• ${settings.api_token_hint}` : "Missing"}</strong><small>Encrypted server-side; never sent back to the browser</small></article>
      <article><span><Coins size={16}/>Current key spend</span><strong>{money(spent, 3)}</strong><small>{budgetPercent}% of {money(budget, 2)} configured limit</small><i><b style={{ width: `${budgetPercent}%` }}/></i></article>
      <article><span><Clock3 size={16}/>Average cost per run</span><strong>{Number(summary.completed_runs) ? money(summary.avg_cost) : "—"}</strong><small>{Number(summary.avg_duration_ms) ? `${(Number(summary.avg_duration_ms) / 1000).toFixed(1)}s average processing time` : "No completed runs yet"}</small></article>
      <article><span><Database size={16}/>Queue</span><strong>{Number(summary.queued_runs) + Number(summary.processing_runs)}</strong><small>{summary.queued_runs} queued · {summary.processing_runs} processing</small></article>
    </section>

    <section className="ai-metric-grid">
      <article><CheckCircle2 size={17}/><span>Completed businesses</span><strong>{Number(summary.completed_runs).toLocaleString("en-IN")}</strong><small>{summary.total_runs} total attempts</small></article>
      <article><Coins size={17}/><span>Spent today</span><strong>{money(summary.today_spend, 4)}</strong><small>Actual Apify run usage</small></article>
      <article><XCircle size={17}/><span>Failed or blocked</span><strong>{Number(summary.failed_runs).toLocaleString("en-IN")}</strong><small>Retry from the activity list</small></article>
      <article><Zap size={17}/><span>Auto enrichment</span><strong>{settings.auto_enrich_on_add ? "ON" : "OFF"}</strong><small>Runs whenever a new ad link is added</small></article>
    </section>

    <section className="ai-settings-panel apify-settings-panel">
      <header><div><span className="technical">Connection and limits</span><h2>Apify settings</h2><p>Paste a new key to replace the current one. Leave it blank to keep the saved key.</p></div>
        <button className={settings.auto_enrich_on_add ? "ai-enabled" : "ai-paused"} onClick={() => setSettings(current => ({ ...current, auto_enrich_on_add: !current.auto_enrich_on_add }))}>{settings.auto_enrich_on_add ? <><Play size={14}/>Automatic scraping on</> : <><Clock3 size={14}/>Automatic scraping off</>}</button></header>
      <div className="ai-settings-grid">
        <label><span>Replace Apify API key</span><input type="password" autoComplete="new-password" value={apiToken} onChange={event => setApiToken(event.target.value)} placeholder={settings.api_key_configured ? `Current key ends in ${settings.api_token_hint}` : "apify_api_…"}/><small>The saved key is AES-256-GCM encrypted using your server secret.</small></label>
        <label><span>Current-key budget limit</span><div className="money-input"><b>$</b><input type="number" min="0.01" max="1000" step="0.01" value={settings.monthly_budget_usd} onChange={event => setSettings(current => ({ ...current, monthly_budget_usd: event.target.value }))}/></div><small>New runs are blocked after this month’s tracked spend reaches the limit.</small></label>
        <label><span>Maximum ads per business</span><input type="number" min="1" max="100" value={settings.max_ads_per_business} onChange={event => setSettings(current => ({ ...current, max_ads_per_business: Number(event.target.value) }))}/><small>Caps downloads and actor output to control cost.</small></label>
      </div>
      {(message || error) && <div className={error ? "settings-message error" : "settings-message success"}>{error || message}</div>}
      <div className="settings-actions"><button className="primary-button compact" disabled={saving} onClick={() => void saveSettings()}>{saving ? <RefreshCw className="spin-icon" size={15}/> : <Save size={15}/>}Save and verify settings</button></div>
    </section>

    <section className="apify-bulk-card"><div><span className="technical">Existing lead backfill</span><h2>Scrape businesses already in Chalkframe</h2><p>{existingCount} businesses have never completed automated enrichment. Each click queues up to 50; the live queue processes them in controlled batches.</p></div><button className="primary-button" disabled={bulkRunning || !settings.api_key_configured} onClick={() => void queue("bulk")}>{bulkRunning ? <RefreshCw className="spin-icon" size={16}/> : <Database size={16}/>}Scrape existing businesses</button></section>

    <section className="ai-run-list apify-run-list"><header><div><span className="technical">Activity and cost audit</span><h2>Recent business enrichments</h2></div><small>{summary.total_runs} attempts on current key</small></header>
      {runs.length ? <div className="run-card-list">{runs.map(run => <article className={`apify-run-card ${run.status}`} key={run.id}><div className="apify-run-main"><div><strong>{run.lead_title || "Meta ad business"}</strong><span className={`run-status-badge ${run.status}`}>{run.status === "completed" ? <CheckCircle2 size={12}/> : run.status === "failed" || run.status === "blocked" ? <AlertTriangle size={12}/> : <Clock3 size={12}/>} {run.status}</span><small>{run.trigger} · {new Date(run.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div><div className="apify-run-metrics"><span>{run.ads_found} ads</span><span>{run.creatives_saved}/{run.creatives_found} images saved</span><span>{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}</span><span>{run.cost_usd ? money(run.cost_usd) : "—"}</span></div></div>{run.error_message && <p className="apify-run-warning"><AlertTriangle size={14}/>{run.error_message}</p>}<footer><Link href={`/dashboard/leads/${run.lead_id}`}>Open business</Link><button disabled={["queued","processing"].includes(run.status)} onClick={() => void queue("lead", run.lead_id)}><RefreshCw size={13}/>Run again</button></footer></article>)}</div> : <div className="ai-empty"><Database size={24}/><strong>No enrichment runs yet</strong><span>Add a key, then scrape an existing or newly added business.</span></div>}
    </section>
  </section>;
}
