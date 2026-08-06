export type EmailDraftStatus = "waiting" | "queued" | "processing" | "completed" | "needs_review" | "blocked" | "failed";

export type EmailDraft = {
  id: string;
  status: EmailDraftStatus;
  subject: string | null;
  body: string | null;
  reviewReason: string | null;
  error: string | null;
  model: string | null;
  costUsd: string | number | null;
  latencyMs: number | null;
  recipientEmail: string | null;
  updatedAt: string;
};
