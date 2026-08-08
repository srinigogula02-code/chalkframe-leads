"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, Clock3, Copy, Image as ImageIcon, Images, Laptop, Mail, RefreshCw, Send, Smartphone, Sparkles, X } from "lucide-react";
import { WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";
import NavDropdown from "@/app/dashboard/_components/nav-dropdown";
import type { SessionUser } from "@/lib/db";
import type { RedesignLead, ReviewImage } from "./page";

export default function RedesignReview({ user, lead, previousId, nextId }: { user: SessionUser | null; lead: RedesignLead; previousId: string | null; nextId: string | null }) {
  const router = useRouter();
  const [redesigns, setRedesigns] = useState(lead.redesign_images);
  const [confirmContacted, setConfirmContacted] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ReviewImage | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState(() => lead.redesign_images.find(image => image.collageStatus === "completed")?.id || lead.redesign_images[0]?.id || "");
  const queueStarted = useRef(false);
  const [error, setError] = useState("");
  const hasPending = redesigns.some(image => ["queued", "processing"].includes(image.collageStatus || "") || ["queued", "processing"].includes(image.emailDraft?.status || ""));
  const hasMissingDraft = redesigns.some(image => image.collageStatus === "completed" && image.collageUrl && !image.emailDraft);

  const refreshCollages = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/leads/${lead.id}`, { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setRedesigns(result.redesignImages);
    } catch {
      /* The next poll retries. */
    }
  }, [lead.id]);

  const queueCollages = useCallback(
    async (retry = true, single = false) => {
      setError("");
      try {
        const response = await fetch(`/api/admin/leads/${lead.id}/collages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ originalImageId: lead.collage_original_image_id, retry, useSingleRedesign: single }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The collage could not be queued.");
        setRedesigns(current => current.map(image => ({ ...image, collageStatus: "queued", collageError: null })));
        window.setTimeout(() => void refreshCollages(), 1400);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The collage could not be queued.");
      } finally {
        queueStarted.current = true;
      }
    },
    [lead.collage_original_image_id, lead.id, refreshCollages],
  );

  useEffect(() => {
    if (!selectedImage && !confirmContacted) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedImage(null);
        setConfirmContacted(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedImage, confirmContacted]);

  useEffect(() => {
    if (!hasPending) return;
    const refresh = () => void refreshCollages();
    const first = window.setTimeout(refresh, 1500);
    const interval = window.setInterval(refresh, 3500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [hasPending, refreshCollages]);

  useEffect(() => {
    if (!hasMissingDraft) return;
    const timer = window.setTimeout(() => void refreshCollages(), 0);
    return () => window.clearTimeout(timer);
  }, [hasMissingDraft, refreshCollages]);

  useEffect(() => {
    if (queueStarted.current || !lead.collage_original_image_id || !redesigns.some(image => ["waiting", "queued"].includes(image.collageStatus || ""))) return;
    queueStarted.current = true;
    void queueCollages(false);
  }, [queueCollages, redesigns, lead.collage_original_image_id]);

  async function copyEmail() {
    if (!lead.email) return;
    setError("");
    let success = false;
    try {
      await navigator.clipboard.writeText(lead.email);
      success = true;
    } catch {
      const field = document.createElement("textarea");
      field.value = lead.email;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      success = document.execCommand("copy");
      field.remove();
    }
    if (!success) {
      setError("Email could not be copied. Allow clipboard access and try again.");
      return;
    }
    setCopied(true);
    setConfirmContacted(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function regenerateEmail(redesignImageId: string) {
    setDraftBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/leads/${lead.id}/email-drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redesignImageId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The email could not be queued.");
      setRedesigns(current =>
        current.map(image =>
          image.id === redesignImageId
            ? {
                ...image,
                emailDraft: image.emailDraft
                  ? { ...image.emailDraft, status: "queued", error: null, reviewReason: null }
                  : {
                      id: `queued-${redesignImageId}`,
                      status: "queued",
                      subject: null,
                      body: null,
                      reviewReason: null,
                      error: null,
                      model: null,
                      costUsd: null,
                      latencyMs: null,
                      recipientEmail: lead.email,
                      updatedAt: new Date().toISOString(),
                      sentAt: null,
                    },
              }
            : image,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The email could not be queued.");
    } finally {
      setDraftBusy(false);
    }
  }

  async function moveToPhase(nextStatus: WorkflowStatus) {
    if (nextStatus === lead.workflow_status) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowStatus: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Phase could not be updated.");
      
      if (nextStatus === "ad_inactive") {
        router.push("/dashboard?status=ad_inactive");
      } else if (nextStatus === "contacted") {
        router.push("/dashboard?status=contacted");
      } else if (nextStatus === "redesign_created") {
        router.push(`/dashboard/redesign-created/${lead.id}`);
      } else {
        router.push(`/dashboard/leads/${lead.id}?status=${nextStatus}`);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phase could not be updated.");
      setBusy(false);
    }
  }

  async function moveToContacted() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/leads/${lead.id}/contacted`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Phase could not be updated.");
      router.push("/dashboard/redesign-created");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phase could not be updated.");
      setConfirmContacted(false);
      setBusy(false);
    }
  }

  return (
    <main className="redesign-review-page">
      <header className="redesign-review-topbar">
        <img src="/brand/chalkframe-logo-dark.svg" alt="Chalkframe" />
        <nav className="record-nav">
          <Link aria-disabled={!previousId} className={!previousId ? "disabled" : ""} href={previousId ? `/dashboard/redesign-created/${previousId}` : "#"}>
            <ArrowLeft size={16} />
            <span>Previous</span>
          </Link>
          <span className="technical">Redesign review</span>
          <Link aria-disabled={!nextId} className={!nextId ? "disabled" : ""} href={nextId ? `/dashboard/redesign-created/${nextId}` : "#"}>
            <span>Next</span>
            <ArrowRight size={16} />
          </Link>
          {user && <NavDropdown user={user} />}
        </nav>
      </header>
      <section className="redesign-review-hero">
          <div className="review-title">
          <div>
            <span className="technical">Redesign created</span>
            <h1>{lead.title || "Meta ad business"}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <a href={lead.ad_url} target="_blank" rel="noreferrer">
              Open source ad <ArrowUpRight size={13} />
            </a>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
              Move phase:
              <select
                value={lead.workflow_status}
                disabled={busy}
                onChange={e => void moveToPhase(e.target.value as WorkflowStatus)}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 5, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
              >
                {WORKFLOW_STATUSES.map(s => (
                  <option key={s} value={s}>{WORKFLOW_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="review-contact-sheet">
          <ComparisonPanel
            images={redesigns}
            hasOriginal={lead.images.length > 0}
            selectedOriginal={Boolean(lead.collage_original_image_id)}
            onSelect={setSelectedImage}
            onRetry={() => void queueCollages(true, false)}
            onRetrySingle={() => void queueCollages(true, true)}
            businessId={lead.id}
            activeId={activeDraftId}
            onChoose={setActiveDraftId}
          />
          <ImageColumn label="Original research" title="Ad creatives" images={lead.images} empty="No ad creative images" onSelect={setSelectedImage} />
          <ImageColumn label="Chalkframe output" title="Redesigns" images={redesigns} empty="No redesign images" onSelect={setSelectedImage} />
          <EmailActionCard
            leadId={lead.id}
            email={lead.email}
            images={redesigns}
            activeId={activeDraftId}
            onChoose={setActiveDraftId}
            copied={copied}
            onCopyRecipient={copyEmail}
            onRegenerate={id => void regenerateEmail(id)}
            busy={draftBusy}
            error={error}
          />
        </div>
      </section>
      {selectedImage && (
        <div className="review-lightbox" role="dialog" aria-modal="true" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedImage(null); }}>
          <button onClick={() => setSelectedImage(null)} aria-label="Close image">
            <X size={20} />
          </button>
          <img src={selectedImage.url} alt={selectedImage.description || "Image preview"} />
        </div>
      )}
      {confirmContacted && (
        <div className="modal-backdrop">
          <div className="contacted-confirm" role="alertdialog" aria-modal="true" aria-labelledby="contacted-title">
            <span>
              <Check size={20} />
            </span>
            <h2 id="contacted-title">Move to Contacted?</h2>
            <p>
              <strong>{lead.email}</strong> was copied. Confirm only after you have sent or recorded the outreach.
            </p>
            <div>
              {error && <div className="review-error">{error}</div>}
              <button className="secondary-button" onClick={() => setConfirmContacted(false)} disabled={busy}>
                Cancel
              </button>
              <button className="primary-button" onClick={moveToContacted} disabled={busy}>
                {busy ? "Updating…" : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ComparisonPanel({
  images,
  hasOriginal,
  selectedOriginal,
  onSelect,
  onRetry,
  onRetrySingle,
  businessId,
  activeId,
  onChoose,
}: {
  images: ReviewImage[];
  hasOriginal: boolean;
  selectedOriginal: boolean;
  onSelect: (image: ReviewImage) => void;
  onRetry: () => void;
  onRetrySingle: () => void;
  businessId: string;
  activeId: string;
  onChoose: (id: string) => void;
}) {
  const ready = images.filter(image => image.collageStatus === "completed" && image.collageUrl);
  const failed = images.some(image => image.collageStatus === "failed");
  const pending = images.some(image => ["queued", "processing"].includes(image.collageStatus || ""));
  return (
    <section className="comparison-review-panel">
      <header>
        <div>
          <span className="technical">Automatic comparison</span>
          <h2>Original + redesign</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            title="Create 16:9 banner using single redesign image centered"
            onClick={onRetrySingle}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#c4b5fd",
              padding: "5px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Sparkles size={13} />
            Use Single Image
          </button>
          <b>16:9</b>
        </div>
      </header>
      {ready.length ? (
        <div className="comparison-review-grid">
          {ready.map((image, index) => (
            <article className={activeId === image.id ? "active" : ""} key={image.id}>
              <button onClick={() => onSelect({ id: `collage-${image.id}`, url: image.collageUrl || "", description: `16:9 comparison collage ${index + 1}` })}>
                <img src={image.collageUrl || ""} alt={`Original and redesign comparison ${index + 1}`} loading={index === 0 ? "eager" : "lazy"} decoding="async" />
              </button>
              <button className="use-email-draft" onClick={() => onChoose(image.id)}>
                {activeId === image.id ? (
                  <>
                    <Check size={12} /> Email shown
                  </>
                ) : (
                  "Show email"
                )}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="comparison-review-empty">
          {pending ? (
            <>
              <Clock3 size={22} />
              <strong>Creating 16:9 banner in the background</strong>
              <span>This page updates automatically.</span>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", padding: "16px" }}>
              <Images size={22} />
              <strong>{failed ? "Original image unreadable / failed" : "16:9 Banner Option"}</strong>
              <span style={{ fontSize: 11, color: "#8291a8", maxWidth: 260 }}>
                {failed
                  ? "Original Facebook ad creative could not be loaded. Generate a 16:9 banner with the single redesign image placed centered in the middle."
                  : "Generate a 16:9 banner using the single redesign image placed centered in the middle."}
              </span>
              <button
                type="button"
                onClick={onRetrySingle}
                style={{
                  marginTop: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#6366f1",
                  color: "#fff",
                  border: 0,
                  padding: "9px 16px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Sparkles size={14} />
                Use Single Redesign Image (Centered)
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmailActionCard({
  leadId,
  email,
  images,
  activeId,
  onChoose,
  copied,
  onCopyRecipient,
  onRegenerate,
  busy,
  error,
}: {
  leadId: string;
  email: string | null;
  images: ReviewImage[];
  activeId: string;
  onChoose: (id: string) => void;
  copied: boolean;
  onCopyRecipient: () => void;
  onRegenerate: (id: string) => void;
  busy: boolean;
  error: string;
}) {
  const [draftCopied, setDraftCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(email || "");
  const [viewMode, setViewMode] = useState<"desktop" | "mobile" | "text">("desktop");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<{ message: string; resendId?: string } | null>(null);
  const [sendError, setSendError] = useState("");

  // Test email
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testSuccess, setTestSuccess] = useState("");
  const [testError, setTestError] = useState("");

  const options = images.filter(image => image.collageStatus === "completed" && image.collageUrl);
  const active = options.find(image => image.id === activeId) || options[0];
  const draft = active?.emailDraft;

  async function copyDraft() {
    if (!draft?.subject || !draft.body) return;
    const value = `Subject: ${draft.subject}\n\n${draft.body}`;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setDraftCopied(true);
    window.setTimeout(() => setDraftCopied(false), 1800);
  }

  async function handleSendTestEmail() {
    if (!testTo.trim()) { setTestError("Enter a test recipient email."); return; }
    if (!draft?.subject || !draft?.body) { setTestError("Draft is not ready."); return; }
    setSendingTest(true);
    setTestError("");
    setTestSuccess("");
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/send-test-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          testTo: testTo.trim(),
          subject: draft.subject,
          bodyMarkdown: draft.body,
          collageUrl: active?.collageUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setTestSuccess(`Sent to ${testTo.trim()}!`);
      setTimeout(() => setTestSuccess(""), 5000);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test send failed.");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleSendViaResend() {
    if (!recipientEmail.trim()) {
      setSendError("Recipient email address is required.");
      return;
    }
    if (!draft?.subject || !draft?.body) {
      setSendError("Email draft content is not ready yet.");
      return;
    }

    setSendingEmail(true);
    setSendError("");
    setSendSuccess(null);

    try {
      const res = await fetch(`/api/admin/leads/${leadId}/send-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail: recipientEmail.trim(),
          subject: draft.subject,
          bodyMarkdown: draft.body,
          collageUrl: active.collageUrl,
          redesignImageId: active.id,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Email delivery failed.");
      setSendSuccess({ message: body.message || "Email sent via Resend!", resendId: body.resendId });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send email via Resend.");
    } finally {
      setSendingEmail(false);
    }
  }

  // Live preview — matches the actual sent email (no dark header banner)
  const generatePreviewHtml = () => {
    if (!draft?.subject || !draft?.body) return "";
    const lines = draft.body.split(/\r?\n/);
    const bodyHtml = lines
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return "<br/>";
        if (/^\s*(?:[-•*]|\d+[\.)])\s+/.test(trimmed)) {
          return `<li style="margin-bottom:7px;line-height:1.6;">${trimmed.replace(/^\s*(?:[-•*]|\d+[\.)])\s+/, "")}</li>`;
        }
        return `<p style="margin:0 0 13px 0;line-height:1.65;">${trimmed}</p>`;
      })
      .join("")
      .replace(/(<li[\s\S]*?<\/li>)+/g, match => `<ul style="margin:10px 0 16px 0;padding-left:20px;color:#1f2937;">${match}</ul>`);

    return `<!doctype html>
<html>
<body style="margin:0;padding:16px 10px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111827;">
  <div style="max-width:580px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    ${active?.collageUrl
      ? `<div style="background:#000;padding:0;"><img src="${active.collageUrl}" style="width:100%;display:block;border-radius:12px 12px 0 0;" alt="Ad Comparison"/></div>`
      : `<div style="background:#1e293b;padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;color:#94a3b8;font-size:12px;">📷 16:9 Ad Comparison Collage</div>`
    }
    <div style="padding:26px 22px 20px;font-size:14px;color:#374151;line-height:1.65;">${bodyHtml}
      <div style="margin-top:22px;text-align:center;">
        <a href="#" style="background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;box-shadow:0 2px 6px rgba(0,0,0,0.1);">View Interactive Ad Breakdown →</a>
      </div>
    </div>
    <div style="padding:16px 22px;background:#f9fafb;border-top:1px solid #f3f4f6;text-align:center;font-size:11px;color:#6b7280;">
      Chalkframe Performance Marketing · Scaling Meta ads with AI performance creatives.
      ${recipientEmail || email ? `<br/><span style="color:#9ca3af;">Sent to ${recipientEmail || email}</span>` : ""}
    </div>
  </div>
</body>
</html>`;
  };

  return (
    <aside className="email-action-card">
      <header>
        <div>
          <span className="technical">Outreach & Resend Dispatch</span>
          <h2>Live Email Preview</h2>
        </div>
        <div className="email-icon">
          <Mail size={18} />
        </div>
      </header>

      {options.length > 1 && (
        <label className="draft-picker">
          Collage
          <select value={active?.id || ""} onChange={event => onChoose(event.target.value)}>
            {options.map((image, index) => (
              <option value={image.id} key={image.id}>
                Redesign {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Recipient Email Input & Viewport Switcher */}
      <div className="recipient-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="email"
            value={recipientEmail}
            onChange={e => setRecipientEmail(e.target.value)}
            placeholder="Recipient email address..."
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
            }}
          />
          <button onClick={onCopyRecipient} disabled={!recipientEmail} title="Copy Email">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>

        {draft?.status === "completed" && (
          <div className="view-mode-buttons" style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "desktop" ? "active" : ""}`}
              onClick={() => setViewMode("desktop")}
              style={{
                flex: 1,
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: viewMode === "desktop" ? "#0f172a" : "#ffffff",
                color: viewMode === "desktop" ? "#ffffff" : "#475569",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              <Laptop size={13} /> Desktop (580px)
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "mobile" ? "active" : ""}`}
              onClick={() => setViewMode("mobile")}
              style={{
                flex: 1,
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: viewMode === "mobile" ? "#0f172a" : "#ffffff",
                color: viewMode === "mobile" ? "#ffffff" : "#475569",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              <Smartphone size={13} /> Mobile (360px)
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "text" ? "active" : ""}`}
              onClick={() => setViewMode("text")}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: viewMode === "text" ? "#0f172a" : "#ffffff",
                color: viewMode === "text" ? "#ffffff" : "#475569",
                cursor: "pointer",
              }}
            >
              Text Only
            </button>
          </div>
        )}
      </div>

      <div className="draft-scroll">
        {!active ? (
          <div className="draft-placeholder">
            <Bot size={19} />
            <strong>Waiting for a collage</strong>
            <span>The email starts after a comparison is ready.</span>
          </div>
        ) : !draft || ["queued", "processing"].includes(draft.status) ? (
          <div className="draft-placeholder processing">
            <Clock3 size={19} />
            <strong>{draft?.status === "processing" ? "Writing email" : "Email queued"}</strong>
            <span>You can leave this page while it runs.</span>
          </div>
        ) : draft.status === "needs_review" ? (
          <div className="draft-warning">
            <AlertTriangle size={17} />
            <strong>Redesign needs review</strong>
            <p>{draft.reviewReason}</p>
          </div>
        ) : ["failed", "blocked", "waiting"].includes(draft.status) ? (
          <div className="draft-warning failed">
            <AlertTriangle size={17} />
            <strong>Email not ready</strong>
            <p>{draft.error || "Generation is paused. Check AI settings and retry."}</p>
          </div>
        ) : viewMode === "text" ? (
          <div className="draft-copy">
            <strong>Subject: {draft.subject}</strong>
            <p>{draft.body}</p>
          </div>
        ) : (
          <div
            className="email-iframe-container"
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              background: "#f1f5f9",
              padding: "10px 0",
              borderRadius: "6px",
            }}
          >
            <iframe
              srcDoc={generatePreviewHtml()}
              title="Resend Email Live Preview"
              style={{
                width: viewMode === "mobile" ? "360px" : "100%",
                maxWidth: viewMode === "mobile" ? "360px" : "580px",
                height: "360px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            />
          </div>
        )}
      </div>

      {sendSuccess && (
        <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", marginTop: "8px" }}>
          <Check size={14} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "4px" }} />
          {sendSuccess.message} {sendSuccess.resendId && <span style={{ opacity: 0.8 }}>(ID: {sendSuccess.resendId})</span>}
        </div>
      )}

      {(sendError || error) && (
        <div className="review-error" style={{ marginTop: "8px" }}>
          {sendError || error}
        </div>
      )}

      {active && (
        <div className="draft-actions" style={{ flexDirection: "column", gap: "8px", marginTop: "10px" }}>
          {draft?.status === "completed" && (
            <button
              type="button"
              className="primary-button"
              onClick={handleSendViaResend}
              disabled={sendingEmail || !recipientEmail.trim()}
              style={{
                width: "100%",
                background: "#f59e0b",
                color: "#0f172a",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              <Send size={15} />
              {sendingEmail ? "Sending via Resend…" : "Send Email via Resend"}
            </button>
          )}

          {/* ── Test Email Panel ── */}
          {draft?.status === "completed" && (
            <div style={{ border: "1px solid #293449", borderRadius: 7, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => { setShowTestPanel(p => !p); setTestError(""); setTestSuccess(""); }}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: showTestPanel ? "#1e293b" : "#172033",
                  border: 0,
                  color: "#a5b4fc",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  gap: 6,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Mail size={12} /> Send test to yourself
                </span>
                <span style={{ fontSize: 9, color: "#64748b" }}>{showTestPanel ? "▲" : "▼"}</span>
              </button>
              {showTestPanel && (
                <div style={{ padding: "10px", background: "#0c1422", display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ fontSize: 9, color: "#64748b", lineHeight: 1.4 }}>
                    Sends the real email (with collage + draft) to any address. Won&apos;t mark lead as contacted.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="email"
                      value={testTo}
                      onChange={e => setTestTo(e.target.value)}
                      placeholder="your@email.com"
                      style={{
                        flex: 1,
                        padding: "6px 9px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "#172033",
                        color: "#e2e8f0",
                        outline: "none",
                      }}
                      onKeyDown={e => { if (e.key === "Enter") void handleSendTestEmail(); }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendTestEmail()}
                      disabled={sendingTest || !testTo.trim()}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: 0,
                        background: sendingTest ? "#334155" : "#4f46e5",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Send size={11} />
                      {sendingTest ? "…" : "Send"}
                    </button>
                  </div>
                  {testSuccess && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#86efac", fontSize: 9, fontWeight: 700 }}>
                      <Check size={11} /> {testSuccess}
                    </div>
                  )}
                  {testError && (
                    <div style={{ color: "#fca5a5", fontSize: 9, lineHeight: 1.4 }}>{testError}</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            {draft?.status === "completed" && (
              <button onClick={copyDraft} style={{ flex: 1 }}>
                {draftCopied ? <Check size={14} /> : <Copy size={14} />} {draftCopied ? "Copied" : "Copy Draft"}
              </button>
            )}
            <button className="draft-regenerate" onClick={() => onRegenerate(active.id)} disabled={busy} style={{ flex: 1 }}>
              <RefreshCw size={13} />
              {busy ? "Queueing…" : draft ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
      )}

      {draft?.model && (
        <small style={{ marginTop: "6px", display: "block", color: "#64748b" }}>
          {draft.model}
          {draft.costUsd !== null ? ` · $${Number(draft.costUsd).toFixed(4)}` : ""}
          {draft.latencyMs ? ` · ${(draft.latencyMs / 1000).toFixed(1)}s` : ""}
        </small>
      )}
    </aside>
  );
}

function ImageColumn({ label, title, images, empty, onSelect }: { label: string; title: string; images: ReviewImage[]; empty: string; onSelect: (image: ReviewImage) => void }) {
  return (
    <section className="review-image-column">
      <header>
        <div>
          <span className="technical">{label}</span>
          <h2>{title}</h2>
        </div>
        <b>{images.length}</b>
      </header>
      {images.length ? (
        <div className="review-image-grid">
          {images.map((image, index) => (
            <button key={image.id || index} onClick={() => onSelect(image)} aria-label={`View ${title} image ${index + 1}`}>
              <img src={image.url} alt={image.description || `${title} image ${index + 1}`} loading={index < 2 ? "eager" : "lazy"} decoding="async" />
            </button>
          ))}
        </div>
      ) : (
        <div className="review-images-empty">
          <ImageIcon size={25} />
          <span>{empty}</span>
        </div>
      )}
    </section>
  );
}
