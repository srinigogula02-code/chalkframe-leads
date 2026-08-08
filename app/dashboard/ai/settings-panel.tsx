"use client";

import { useMemo, useState } from "react";
import { Check, Edit3, MailCheck, Pause, Play, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { CurrencyCode, DEFAULT_USD_TO_INR, formatCurrency, formatPerMillion } from "@/lib/currency";
import type { OpenRouterModelOption } from "@/lib/openrouter-models";

export type AISettings = {
  enabled: boolean;
  auto_send_enabled: boolean;
  model: string;
  fallback_model: string | null;
  temperature: string | number;
  max_output_tokens: number;
  max_cost_usd: string | number;
  monthly_budget_usd: string | number;
  system_prompt_override: string | null;
  updated_at: string;
};

function ModelSelectorField({
  label,
  sublabel,
  value,
  onChange,
  models,
  currency = "INR",
  exchangeRate = DEFAULT_USD_TO_INR,
  placeholder,
}: {
  label: string;
  sublabel?: string;
  value: string;
  onChange: (val: string) => void;
  models: OpenRouterModelOption[];
  currency?: CurrencyCode;
  exchangeRate?: number;
  placeholder?: string;
}) {
  const visionModels = useMemo(() => models.filter(m => m.isVision), [models]);
  const [customMode, setCustomMode] = useState(() => {
    return Boolean(value && !visionModels.some(m => m.id === value));
  });

  const selectedModel = useMemo(() => visionModels.find(m => m.id === value), [visionModels, value]);

  return (
    <div className="ai-model-field">
      <div className="model-field-header">
        <span>
          {label} {sublabel && <i>{sublabel}</i>}
        </span>
        <button
          type="button"
          className="model-mode-btn"
          onClick={() => setCustomMode(!customMode)}
        >
          {customMode ? "Select from vision list" : "Type custom ID"}
        </button>
      </div>

      {customMode ? (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || "provider/model-id"}
          className="ai-model-custom-input"
        />
      ) : (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="ai-model-select"
        >
          {!value && <option value="">-- Choose a vision-capable OpenRouter model --</option>}
          <optgroup label={`📷 Vision-Capable Models (${visionModels.length} available)`}>
            {visionModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id}) — {formatPerMillion(m.promptPrice, currency, exchangeRate)} in / {formatPerMillion(m.completionPrice, currency, exchangeRate)} out
              </option>
            ))}
          </optgroup>
        </select>
      )}

      <small>
        {selectedModel
          ? `${selectedModel.name} (${selectedModel.id}) · 📷 Vision · ${formatPerMillion(selectedModel.promptPrice, currency, exchangeRate)} input · ${formatPerMillion(selectedModel.completionPrice, currency, exchangeRate)} output`
          : value
          ? `Custom model ID: ${value}`
          : `Choose from ${visionModels.length} vision-capable OpenRouter models.`}
      </small>
    </div>
  );
}

export default function SettingsPanel({
  initial,
  resendConfigured,
  models,
  defaultPrompt,
  currency = "INR",
  exchangeRate = DEFAULT_USD_TO_INR,
}: {
  initial: AISettings;
  resendConfigured: boolean;
  models: OpenRouterModelOption[];
  defaultPrompt: string;
  currency?: CurrencyCode;
  exchangeRate?: number;
}) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activePromptText = settings.system_prompt_override !== null ? settings.system_prompt_override : defaultPrompt;
  const isCustomOverride = settings.system_prompt_override !== null && settings.system_prompt_override.trim() !== defaultPrompt.trim();

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
          autoSendEnabled: settings.auto_send_enabled,
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

  function loadDefaultIntoEditor() {
    setSettings(current => ({ ...current, system_prompt_override: defaultPrompt }));
  }

  function resetToDefault() {
    setSettings(current => ({ ...current, system_prompt_override: null }));
  }

  return (
    <section className="ai-settings-panel">
      <header>
        <div>
          <span className="technical">Generation controls</span>
          <h2>Email model settings</h2>
          <p>Changes apply to future drafts and manual regenerations. Select from all available OpenRouter models or customize system instructions.</p>
        </div>
        <div className="ai-settings-toggles">
          <button
            className={settings.enabled ? "ai-enabled" : "ai-paused"}
            onClick={() => setSettings(current => ({ ...current, enabled: !current.enabled }))}
          >
            {settings.enabled ? <><Play size={14} /> Generation active</> : <><Pause size={14} /> Generation paused</>}
          </button>
          <button
            className={settings.auto_send_enabled ? "ai-auto-send-enabled" : "ai-auto-send-paused"}
            onClick={() => setSettings(current => ({ ...current, auto_send_enabled: !current.auto_send_enabled }))}
            disabled={!resendConfigured}
            title={resendConfigured ? "Automatically deliver newly completed drafts" : "Configure RESEND_API_KEY before enabling auto-send"}
          >
            <MailCheck size={14} /> {settings.auto_send_enabled ? "Auto-send active" : "Auto-send off"}
          </button>
          <small>{resendConfigured ? "When active, every newly completed draft is sent immediately to the business email." : "RESEND_API_KEY is required for automatic delivery."}</small>
        </div>
      </header>

      <div className="ai-settings-grid">
        <ModelSelectorField
          label="Primary model"
          value={settings.model}
          onChange={val => setSettings(current => ({ ...current, model: val }))}
          models={models}
          currency={currency}
          exchangeRate={exchangeRate}
          placeholder="e.g. google/gemini-2.5-flash"
        />

        <ModelSelectorField
          label="Fallback model"
          sublabel="Optional"
          value={settings.fallback_model || ""}
          onChange={val => setSettings(current => ({ ...current, fallback_model: val || null }))}
          models={models}
          currency={currency}
          exchangeRate={exchangeRate}
          placeholder="e.g. openai/gpt-4o-mini"
        />

        <label>
          <span>Temperature</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.05"
            value={settings.temperature}
            onChange={event => setSettings(current => ({ ...current, temperature: event.target.value }))}
          />
          <small>Lower values keep outreach consistent and factual.</small>
        </label>

        <label>
          <span>Maximum output tokens</span>
          <input
            type="number"
            min="200"
            max="2000"
            step="50"
            value={settings.max_output_tokens}
            onChange={event => setSettings(current => ({ ...current, max_output_tokens: Number(event.target.value) }))}
          />
          <small>Includes the email body and review explanations.</small>
        </label>

        <label>
          <span>Per-email cost guard</span>
          <div className="money-input">
            <b>$</b>
            <input
              type="number"
              min="0.001"
              max="10"
              step="0.001"
              value={settings.max_cost_usd}
              onChange={event => setSettings(current => ({ ...current, max_cost_usd: event.target.value }))}
            />
          </div>
          <small>
            Equivalent to {formatCurrency(settings.max_cost_usd, currency, 3, exchangeRate)}. Stops execution if crossed.
          </small>
        </label>

        <label>
          <span>Monthly budget</span>
          <div className="money-input">
            <b>$</b>
            <input
              type="number"
              min="0.01"
              max="10000"
              step="1"
              value={settings.monthly_budget_usd}
              onChange={event => setSettings(current => ({ ...current, monthly_budget_usd: event.target.value }))}
            />
          </div>
          <small>
            Equivalent to {formatCurrency(settings.monthly_budget_usd, currency, 2, exchangeRate)}. Pauses new generation when reached.
          </small>
        </label>
      </div>

      {/* Prominent System Prompt Editor */}
      <div className="system-prompt-editor-card">
        <header className="prompt-editor-header">
          <div className="prompt-title-group">
            <ShieldCheck size={18} className="prompt-icon" />
            <div>
              <h3>System Prompt Instructions</h3>
              <p>Customize the copywriter AI agent instructions used for outreach generation.</p>
            </div>
          </div>
          <span className={`prompt-status-badge ${isCustomOverride ? "override" : "default"}`}>
            {isCustomOverride ? "Custom Override Active" : "Using Chalkframe Default"}
          </span>
        </header>

        <div className="prompt-toolbar">
          <button type="button" className="prompt-tool-btn" onClick={loadDefaultIntoEditor}>
            <Edit3 size={13} /> Load Default Prompt to Edit
          </button>
          {isCustomOverride && (
            <button type="button" className="prompt-tool-btn danger" onClick={resetToDefault}>
              <RefreshCw size={13} /> Reset to Default Prompt
            </button>
          )}
        </div>

        <textarea
          className="system-prompt-textarea"
          rows={16}
          value={activePromptText}
          onChange={event => {
            const val = event.target.value;
            setSettings(current => ({
              ...current,
              system_prompt_override: val.trim() === defaultPrompt.trim() ? null : val,
            }));
          }}
          placeholder={defaultPrompt}
        />

        <div className="prompt-footer">
          <small>{activePromptText.length.toLocaleString()} characters</small>
          <small>{isCustomOverride ? "Changes will replace the default instructions on save." : "Editing the text above will save a custom prompt override."}</small>
        </div>
      </div>

      {(message || error) && (
        <div className={`ai-save-message ${error ? "error" : ""}`}>
          {error || (
            <>
              <Check size={14} />
              {message}
            </>
          )}
        </div>
      )}

      <footer>
        <span>Last saved {new Date(settings.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
        <button className="primary-button" onClick={save} disabled={saving}>
          <Save size={15} />
          {saving ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </section>
  );
}
