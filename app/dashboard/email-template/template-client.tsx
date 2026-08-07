"use client";

import { useState } from "react";
import { Check, Laptop, Mail, Save, Send, Smartphone, Sparkles, Type, FlaskConical, ToggleLeft, ToggleRight } from "lucide-react";
import type { EmailTemplateSettings } from "@/lib/resend-email";

export default function EmailTemplateClient({
  initialTemplate,
}: {
  initialTemplate: EmailTemplateSettings;
}) {
  const [template, setTemplate] = useState<EmailTemplateSettings>(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const [viewportMode, setViewportMode] = useState<"desktop" | "mobile">("desktop");

  // Test HTML email
  const [testTo, setTestTo] = useState("");
  const [testSubject, setTestSubject] = useState("Chalkframe · Your Ad Creative Redesign [TEST]");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testErr, setTestErr] = useState("");

  // Plain email sender
  const [plainTo, setPlainTo] = useState("");
  const [plainSubject, setPlainSubject] = useState("Chalkframe · Your Ad Creative Redesign");
  const [plainBody, setPlainBody] = useState(
    "Hi there,\n\nWe analyzed your recent Meta ad creative and crafted a high-converting redesign for Instagram.\n\nHere are the key improvements:\n- Mobile-first typography & contrast\n- Stronger CTA button visibility\n- Reduced visual clutter\n\nLet us know if you would like to discuss further.\n\nThanks,\nSrinivas Gogula"
  );
  const [sendingPlain, setSendingPlain] = useState(false);
  const [plainMsg, setPlainMsg] = useState("");
  const [plainErr, setPlainErr] = useState("");

  const colorPresets = ["#f59e0b", "#6366f1", "#3b82f6", "#10b981", "#ec4899", "#ef4444", "#0f172a"];
  const accent = template.accent_color || "#f59e0b";
  const esc = (s: string) =>
    String(s || "").replace(
      /[&<>"']/g,
      (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c] || c
    );

  async function save() {
    setSaving(true);
    setSaveMsg("");
    setSaveError("");
    try {
      const res = await fetch("/api/admin/email-templates/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          showCta: template.show_cta,
          ctaButtonText: template.cta_button_text,
          ctaButtonUrlOverride: template.cta_button_url_override,
          footerText: template.footer_text,
          accentColor: template.accent_color,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save settings.");
      setTemplate(data.template ?? template);
      setSaveMsg("Template settings saved!");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testTo.trim()) { setTestErr("Recipient email is required."); return; }
    setSendingTest(true);
    setTestErr("");
    setTestMsg("");
    try {
      const res = await fetch("/api/admin/email-templates/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: testTo.trim(), subject: testSubject.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setTestMsg(`Sent! Resend ID: ${data.resendId || "—"}`);
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSendingTest(false);
    }
  }

  async function sendPlainEmail() {
    if (!plainTo.trim()) { setPlainErr("Recipient email is required."); return; }
    if (!plainSubject.trim()) { setPlainErr("Subject is required."); return; }
    if (!plainBody.trim()) { setPlainErr("Body is required."); return; }
    setSendingPlain(true);
    setPlainErr("");
    setPlainMsg("");
    try {
      const res = await fetch("/api/admin/email-templates/send-plain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: plainTo.trim(), subject: plainSubject.trim(), body: plainBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setPlainMsg(`Sent! Resend ID: ${data.resendId || "—"}`);
    } catch (e) {
      setPlainErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSendingPlain(false);
    }
  }

  const renderLiveHtml = () => `<!doctype html>
<html><body style="margin:0;padding:20px 12px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111827;">
  <div style="max-width:580px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <div style="background:#000;text-align:center;padding:0;">
      <div style="background:#1e293b;color:#94a3b8;padding:32px 16px;font-size:12px;border-radius:12px 12px 0 0;">
        📷 16:9 Ad Collage Banner (Original vs Redesign)
      </div>
    </div>
    <div style="padding:26px 24px 20px;font-size:15px;color:#374151;line-height:1.65;">
      <p style="margin:0 0 12px 0;">Hi there,</p>
      <p style="margin:0 0 12px 0;">We analyzed your Meta ad creative and crafted a high-converting redesign for Instagram and Facebook placements.</p>
      <ul style="margin:10px 0 18px 0;padding-left:20px;color:#1f2937;">
        <li style="margin-bottom:7px;">Mobile-first typography with stronger visual hierarchy</li>
        <li style="margin-bottom:7px;">Contrast-optimised color palette for scroll performance</li>
        <li style="margin-bottom:7px;">Restructured CTA placement above the fold</li>
      </ul>
      <div style="margin-top:22px;text-align:center;">
        ${template.show_cta !== false ? `<a href="#" style="background:${esc(accent)};color:#0f172a;font-weight:700;font-size:14px;text-decoration:none;padding:12px 26px;border-radius:8px;display:inline-block;">${esc(template.cta_button_text)} →</a>` : `<p style="font-size:11px;color:#9ca3af;margin:0;">CTA button hidden</p>`}
      </div>
    </div>
    <div style="padding:18px 24px;background:#f9fafb;border-top:1px solid #f3f4f6;text-align:center;font-size:12px;color:#6b7280;">
      ${template.footer_text ? `<p style="margin:0 0 5px 0;">${esc(template.footer_text)}</p>` : ""}
      <p style="margin:0;font-size:11px;color:#9ca3af;">You're receiving this because we came across your Meta ad and noticed an opportunity to significantly improve its creative performance.</p>
    </div>
  </div>
</body></html>`;

  return (
    <div className="workspace ai-workspace">
      <header className="topbar ai-topbar">
        <div>
          <span className="technical">Outreach</span>
          <h1>Email Settings</h1>
          <p>Customize the email layout and send test or plain text emails via Resend.</p>
        </div>
      </header>

      {/* ── HTML Template Editor ── */}
      <section className="ai-settings-panel" style={{ marginBottom: 18 }}>
        <header>
          <div>
            <span className="technical">HTML Template</span>
            <h2>Email Layout</h2>
            <p style={{ marginTop: 6, color: "#64748b", fontSize: 10 }}>
              Controls the accent color, CTA button, and footer used in all styled HTML emails sent from the Redesign review page.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={save}
            disabled={saving}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", whiteSpace: "nowrap" }}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save Template"}
          </button>
        </header>

        {(saveMsg || saveError) && (
          <div className={`ai-save-message${saveError ? " error" : ""}`} style={{ marginTop: 16 }}>
            {saveMsg || saveError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, marginTop: 22, alignItems: "start" }}>

          {/* Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <div style={{ display: "grid", gap: 8, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>Accent Color</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="color"
                  value={template.accent_color}
                  onChange={e => setTemplate(t => ({ ...t, accent_color: e.target.value }))}
                  style={{ width: 38, height: 38, border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", padding: 2 }}
                />
                <input
                  type="text"
                  value={template.accent_color}
                  onChange={e => setTemplate(t => ({ ...t, accent_color: e.target.value }))}
                  style={{ width: 86, padding: "7px 9px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
                />
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {colorPresets.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setTemplate(t => ({ ...t, accent_color: c }))}
                      title={c}
                      style={{
                        width: 22, height: 22, borderRadius: "50%", background: c, padding: 0,
                        border: template.accent_color === c ? "2px solid #0f172a" : "1px solid #cbd5e1",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>CTA Button Text</span>
              <input
                type="text"
                value={template.cta_button_text}
                onChange={e => setTemplate(t => ({ ...t, cta_button_text: e.target.value }))}
                disabled={template.show_cta === false}
                style={{ padding: "8px 10px", fontSize: 13, opacity: template.show_cta === false ? 0.4 : 1 }}
              />
            </label>

            {/* CTA Toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: template.show_cta !== false ? "#f0fdf4" : "#fef2f2", border: `1px solid ${template.show_cta !== false ? "#86efac" : "#fca5a5"}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>CTA Button</span>
                <span style={{ fontSize: 10, color: "#6b7280" }}>
                  {template.show_cta !== false ? "Shown in email" : "Hidden from email"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTemplate(t => ({ ...t, show_cta: t.show_cta === false ? true : false }))}
                style={{ background: "none", border: 0, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: template.show_cta !== false ? "#16a34a" : "#dc2626" }}
                title={template.show_cta !== false ? "Click to hide CTA button" : "Click to show CTA button"}
              >
                {template.show_cta !== false
                  ? <ToggleRight size={32} strokeWidth={1.5} />
                  : <ToggleLeft size={32} strokeWidth={1.5} />}
              </button>
            </div>

            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>CTA URL Override <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></span>
              <input
                type="url"
                value={template.cta_button_url_override || ""}
                onChange={e => setTemplate(t => ({ ...t, cta_button_url_override: e.target.value || null }))}
                placeholder="Leave blank to use lead's source ad URL"
                style={{ padding: "8px 10px", fontSize: 13 }}
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>Footer Text</span>
              <textarea
                rows={3}
                value={template.footer_text}
                onChange={e => setTemplate(t => ({ ...t, footer_text: e.target.value }))}
                style={{ padding: "8px 10px", fontSize: 12, resize: "vertical" }}
              />
            </label>

            {/* ── Test Send (Styled HTML) ── */}
            <div style={{ marginTop: 6, padding: 14, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12, fontWeight: 700, color: "#0369a1" }}>
                <FlaskConical size={14} /> Send Test Email
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 700, color: "#475569" }}>
                  <span>Recipient</span>
                  <input
                    type="email"
                    value={testTo}
                    onChange={e => setTestTo(e.target.value)}
                    placeholder="you@example.com"
                    style={{ padding: "7px 9px", fontSize: 12 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 700, color: "#475569" }}>
                  <span>Subject</span>
                  <input
                    type="text"
                    value={testSubject}
                    onChange={e => setTestSubject(e.target.value)}
                    style={{ padding: "7px 9px", fontSize: 12 }}
                  />
                </label>
                {testErr && <div className="ai-save-message error" style={{ margin: 0 }}>{testErr}</div>}
                {testMsg && (
                  <div className="ai-save-message" style={{ margin: 0 }}>
                    <Check size={12} style={{ display: "inline", marginRight: 4 }} />{testMsg}
                  </div>
                )}
                <button
                  type="button"
                  className="primary-button"
                  onClick={sendTestEmail}
                  disabled={sendingTest}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#0369a1" }}
                >
                  <Send size={13} />
                  {sendingTest ? "Sending…" : "Send Test HTML Email"}
                </button>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#334155" }}>
                <Sparkles size={14} /> Live Preview
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {(["desktop", "mobile"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewportMode(mode)}
                    style={{
                      padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6,
                      border: "1px solid #cbd5e1", cursor: "pointer",
                      background: viewportMode === mode ? "#0f172a" : "#fff",
                      color: viewportMode === mode ? "#fff" : "#475569",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {mode === "desktop" ? <Laptop size={12} /> : <Smartphone size={12} />}
                    {mode === "desktop" ? "Desktop (580px)" : "Mobile (360px)"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
              <iframe
                srcDoc={renderLiveHtml()}
                title="Email Preview"
                style={{
                  width: viewportMode === "mobile" ? 360 : "100%",
                  maxWidth: viewportMode === "mobile" ? 360 : 580,
                  height: 500,
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#fff",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  flexShrink: 0,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Plain Email Sender ── */}
      <section className="ai-settings-panel">
        <header>
          <div>
            <span className="technical">Plain Email</span>
            <h2>Send a Plain Text Email</h2>
            <p style={{ marginTop: 6, color: "#64748b", fontSize: 10 }}>
              Send a clean plain text email directly via Resend — no HTML, no banner image, no formatting.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 8, background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#475569", fontSize: 10, fontWeight: 700 }}>
            <Type size={13} /> Plain Text Mode
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>Recipient Email</span>
              <input
                type="email"
                value={plainTo}
                onChange={e => setPlainTo(e.target.value)}
                placeholder="lead@business.com"
                style={{ padding: "9px 11px", fontSize: 13 }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>Subject Line</span>
              <input
                type="text"
                value={plainSubject}
                onChange={e => setPlainSubject(e.target.value)}
                style={{ padding: "9px 11px", fontSize: 13 }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>
              <span>Email Body</span>
              <textarea
                rows={11}
                value={plainBody}
                onChange={e => setPlainBody(e.target.value)}
                style={{ padding: "10px 11px", fontSize: 12, lineHeight: 1.6, resize: "vertical" }}
              />
            </label>
            {plainErr && <div className="ai-save-message error">{plainErr}</div>}
            {plainMsg && (
              <div className="ai-save-message">
                <Check size={12} style={{ display: "inline", marginRight: 4 }} />{plainMsg}
              </div>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={sendPlainEmail}
              disabled={sendingPlain}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <Send size={14} />
              {sendingPlain ? "Sending via Resend…" : "Send Plain Email"}
            </button>
          </div>

          {/* Plain preview */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12, fontWeight: 700, color: "#334155" }}>
              <Mail size={14} /> Preview
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20, fontSize: 13.5, lineHeight: 1.7, color: "#374151", fontFamily: "Georgia, serif", minHeight: 330 }}>
              {plainSubject && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 16, fontFamily: "ui-monospace, monospace" }}>
                  Subject: {plainSubject}
                </div>
              )}
              <div style={{ whiteSpace: "pre-wrap" }}>
                {plainBody || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Email body will appear here…</span>}
              </div>
            </div>
            <p style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
              Sent as plain text via Resend. Send is logged in the Stats page.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
