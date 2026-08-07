import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { EmailDraft } from "@/lib/email-draft-types";
import type { WorkflowStatus } from "@/lib/workflow";
import RedesignReview from "./review";

export const dynamic = "force-dynamic";

export type ReviewImage = { id: string; url: string; description: string | null; collageUrl?:string|null; collageStatus?:"waiting"|"queued"|"processing"|"completed"|"failed"; collageError?:string|null; emailDraft?:EmailDraft|null };
export type RedesignLead = { id: string; title: string | null; ad_url: string; email: string | null; workflow_status: WorkflowStatus; created_at:string; collage_original_image_id:string|null; images: ReviewImage[]; redesign_images: ReviewImage[] };

export default async function RedesignCreatedBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const { id } = await params;
  const rows = await sql`SELECT l.id, l.title, l.ad_url, l.email, l.workflow_status, l.created_at::text as created_at_text, l.collage_original_image_id,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id), '[]') AS images,
    COALESCE((SELECT json_agg(json_build_object('id', r.id, 'url', r.url, 'description', r.description, 'collageUrl', r.collage_url, 'collageStatus', CASE WHEN r.collage_status='processing' AND r.collage_started_at < now() - interval '2 minutes' THEN 'failed' ELSE r.collage_status END, 'collageError', CASE WHEN r.collage_status='processing' AND r.collage_started_at < now() - interval '2 minutes' THEN 'Background generation timed out. Retry the collage.' ELSE r.collage_error END, 'emailDraft', (SELECT json_build_object('id', d.id, 'status', CASE WHEN d.status='processing' AND d.started_at < now() - interval '5 minutes' THEN 'failed' ELSE d.status END, 'subject', d.subject, 'body', d.body, 'reviewReason', d.review_reason, 'error', CASE WHEN d.status='processing' AND d.started_at < now() - interval '5 minutes' THEN 'Background generation timed out. Regenerate the email.' ELSE d.error_message END, 'model', COALESCE(d.actual_model, d.requested_model), 'costUsd', d.cost_usd, 'latencyMs', d.latency_ms, 'recipientEmail', d.recipient_email, 'updatedAt', d.updated_at) FROM lead_email_drafts d WHERE d.redesign_image_id=r.id)) ORDER BY r.position) FROM redesign_images r WHERE r.lead_id=l.id), '[]') AS redesign_images
    FROM leads l WHERE l.id=${id}`;
  if (!rows[0]) notFound();
  // Only allow redesign_created leads to be reviewed here
  if (rows[0].workflow_status !== "redesign_created") redirect("/dashboard/redesign-created");
  const createdAtText = rows[0].created_at_text;
  const [previous, next] = await Promise.all([
    sql`SELECT id FROM leads WHERE workflow_status='redesign_created' AND id != ${id} AND (created_at > ${createdAtText}::timestamptz OR (created_at = ${createdAtText}::timestamptz AND id > ${id})) ORDER BY created_at ASC, id ASC LIMIT 1`,
    sql`SELECT id FROM leads WHERE workflow_status='redesign_created' AND id != ${id} AND (created_at < ${createdAtText}::timestamptz OR (created_at = ${createdAtText}::timestamptz AND id < ${id})) ORDER BY created_at DESC, id DESC LIMIT 1`,
  ]);
  const previousId = previous[0]?.id ? String(previous[0].id) : null;
  const nextId = next[0]?.id ? String(next[0].id) : null;
  return <RedesignReview user={user} lead={rows[0] as unknown as RedesignLead} previousId={previousId} nextId={nextId}/>;
}
