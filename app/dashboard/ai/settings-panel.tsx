"use client";

import { useMemo, useState } from "react";
import { Check, Pause, Play, Save, ShieldCheck } from "lucide-react";
import type { OpenRouterModelOption } from "@/lib/openrouter-models";

export type AISettings = {
  enabled: boolean;
  model: string;
  fallback_model: string | null;
  temperature: string | number;
  max_output_tokens: number;
  max_cost_usd: string | number;
  monthly_budget_usd: string | number;
  system_prompt_override: string | null;
  updated_at: string;
};

function perMillion(value: number | null) {
  if (value === null) return "Router pricing";
  return `$${(value * 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}/1M`;
}

export default function SettingsPanel({ initial, models, defaultPrompt }: { initial: AISettings; models: OpenRouterModelOption[]; defaultPrompt: string }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = useMemo(() => models.find(model => model.id === settings.model), [models, settings.model]);
  const fallback = useMemo(() => models.find(model => model.id === settings.fallback_model), [models, settings.fallback_model]);

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/ai/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          model: settings.model,
          fallbackModel: settings.fallback_model,
          temperature: settings.temperature,
          maxOutputTokens: settings.max_output_tokens,
          maxCostUsd: settings.max_cost_usd,
          monthlyBudgetUsd: settings.monthly_budget_usd,
          systemPromptOverride: settings.system_prompt_override,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Settings could not be saved.");
      setSettings(current => ({ ...current, ...body.settings }));
      setMessage("AI email settings saved. New and regenerated drafts will use them.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="ai-settings-panel">
    <header><div><span className="technical">Generation controls</span><h2>Email model settings</h2><p>Changes apply to future drafts and manual regenerations. Existing completed drafts are preserved.</p></div><button className={settings.enabled ? "ai-enabled" : "ai-paused"} onClick={() => setSettings(current => ({ ...current, enabled: !current.enabled }))}>{settings.enabled ? <><Play size={14}/>Generation active</> : <><Pause size={14}/>Generation paused</>}</button></header>
    <div className="ai-settings-grid">
      <label className="ai-model-field"><span>Primary vision model</span><input list="openrouter-vision-models" value={settings.model} onChange={event => setSettings(current => ({ ...current, model: event.target.value }))} placeholder="provider/model"/><small>{selected ? `${selected.name} · ${perMillion(selected.promptPrice)} input · ${perMillion(selected.completionPrice)} output` : models.length ? "Choose an image-input, text-output model from the list." : "Live model catalog is temporarily unavailable; enter an exact OpenRouter model ID."}</small></label>
      <label className="ai-model-field"><span>Fallback model <i>Optional</i></span><input list="openrouter-vision-models" value={settings.fallback_model || ""} onChange={event => setSettings(current => ({ ...current, fallback_model: event.target.value || null }))} placeholder="Used if the primary provider fails"/><small>{fallback ? `${fallback.name} · ${perMillion(fallback.promptPrice)} input · ${perMillion(fallback.completionPrice)} output` : "OpenRouter can route here if the primary model is unavailable."}</small></label>
      <datalist id="openrouter-vision-models">{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
      <label><span>Temperature</span><input type="number" min="0" max="2" step="0.05" value={settings.temperature} onChange={event => setSettings(current => ({ ...current, temperature: event.target.value }))}/><small>Lower values keep outreach consistent and factual.</small></label>
      <label><span>Maximum output tokens</span><input type="number" min="200" max="2000" step="50" value={settings.max_output_tokens} onChange={event => setSettings(current => ({ ...current, max_output_tokens: Number(event.target.value) }))}/><small>Includes the email or redesign-review explanation.</small></label>
      <label><span>Per-email cost guard</span><div className="money-input"><b>$</b><input type="number" min="0.001" max="10" step="0.001" value={settings.max_cost_usd} onChange={event => setSettings(current => ({ ...current, max_cost_usd: event.target.value }))}/></div><small>The agent stops if one generation crosses this threshold.</small></label>
      <label><span>Monthly budget</span><div className="money-input"><b>$</b><input type="number" min="0.01" max="10000" step="1" value={settings.monthly_budget_usd} onChange={event => setSettings(current => ({ ...current, monthly_budget_usd: event.target.value }))}/></div><small>New drafts are held when the app reaches this amount.</small></label>
    </div>
    <details className="prompt-override"><summary><ShieldCheck size={15}/><span>System prompt</span><small>{settings.system_prompt_override ? "Custom override active" : "Using Chalkframe default"}</small></summary><p>Leave this empty to use the tested Chalkframe prompt. An override replaces it completely.</p><textarea rows={14} value={settings.system_prompt_override || ""} onChange={event => setSettings(current => ({ ...current, system_prompt_override: event.target.value || null }))} placeholder={defaultPrompt}/><button type="button" onClick={() => setSettings(current => ({ ...current, system_prompt_override: null }))}>Reset to Chalkframe default</button></details>
    {(message || error) && <div className={`ai-save-message ${error ? "error" : ""}`}>{error || <><Check size={14}/>{message}</>}</div>}
    <footer><span>Last saved {new Date(settings.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span><button className="primary-button" onClick={save} disabled={saving}><Save size={15}/>{saving ? "Saving…" : "Save settings"}</button></footer>
  </section>;
}
