import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processCollageQueue } from "@/lib/collage";
import { sql } from "@/lib/db";
import { processEmailDraftQueue, queueEmailDraftsForLead } from "@/lib/openrouter-email";
import { isWorkflowStatus } from "@/lib/workflow";

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const validUrl = (value: string) => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SavedImage = {
  id: string; url: string; description: string | null; collageUrl: string | null;
  collageStatus: "waiting" | "queued" | "processing" | "completed" | "failed"; collageError: string | null;
};
type ParsedImage = { id:string; suppliedId:string; url:string; description:string; position:number };
export const maxDuration = 300;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const queued = await queueEmailDraftsForLead(id).catch(() => ({ queued: 0 }));
  const rows = await sql`SELECT l.collage_original_image_id,
    COALESCE(json_agg(json_build_object('id', r.id, 'url', r.url, 'description', r.description, 'collageUrl', r.collage_url, 'collageStatus', CASE WHEN r.collage_status='processing' AND r.collage_started_at < now() - interval '2 minutes' THEN 'failed' ELSE r.collage_status END, 'collageError', CASE WHEN r.collage_status='processing' AND r.collage_started_at < now() - interval '2 minutes' THEN 'Background generation timed out. Retry the collage.' ELSE r.collage_error END, 'emailDraft', CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('id', d.id, 'status', CASE WHEN d.status='processing' AND d.started_at < now() - interval '5 minutes' THEN 'failed' ELSE d.status END, 'subject', d.subject, 'body', d.body, 'reviewReason', d.review_reason, 'error', CASE WHEN d.status='processing' AND d.started_at < now() - interval '5 minutes' THEN 'Background generation timed out. Regenerate the email.' ELSE d.error_message END, 'model', COALESCE(d.actual_model, d.requested_model), 'costUsd', d.cost_usd, 'latencyMs', d.latency_ms, 'recipientEmail', d.recipient_email, 'updatedAt', d.updated_at) END) ORDER BY r.position) FILTER (WHERE r.id IS NOT NULL), '[]') AS redesign_images
    FROM leads l LEFT JOIN redesign_images r ON r.lead_id=l.id LEFT JOIN lead_email_drafts d ON d.redesign_image_id=r.id WHERE l.id=${id} GROUP BY l.id`;
  if (!rows[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  if (queued.queued > 0) after(() => processEmailDraftQueue(id));
  return NextResponse.json({ collageOriginalImageId: rows[0].collage_original_image_id, redesignImages: rows[0].redesign_images });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (!isWorkflowStatus(body.workflowStatus)) return NextResponse.json({ error: "Choose a valid business status." }, { status: 400 });

  // If redesignImages is not provided, update only the lead record (e.g. status change)
  if (body.redesignImages === undefined) {
    const chatgptUrl = clean(body.chatgptUrl, 4_000);
    if (chatgptUrl && !validUrl(chatgptUrl)) return NextResponse.json({ error: "ChatGPT URL must start with http:// or https://." }, { status: 400 });
    const requestedOriginal = clean(body.collageOriginalImageId, 36);

    const rows = await sql`
      UPDATE leads
      SET admin_notes = COALESCE(${clean(body.adminNotes, 10_000) || null}, admin_notes),
          chatgpt_url = COALESCE(${chatgptUrl || null}, chatgpt_url),
          workflow_status = ${body.workflowStatus},
          collage_original_image_id = CASE WHEN ${Boolean(requestedOriginal)} THEN ${requestedOriginal}::uuid ELSE collage_original_image_id END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, workflow_status, collage_original_image_id
    `;
    if (!rows[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    return NextResponse.json({ saved: true, workflowStatus: rows[0].workflow_status, collageOriginalImageId: rows[0].collage_original_image_id });
  }

  const rawImages:unknown[] = Array.isArray(body.redesignImages) ? body.redesignImages : [];
  const images:ParsedImage[] = rawImages.slice(0, 30).map((item: unknown, position: number) => {
    const image = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const suppliedId = clean(image.id, 36);
    return { id: suppliedId && uuidPattern.test(suppliedId) ? suppliedId : randomUUID(), suppliedId, url: clean(image.url, 4_000), description: clean(image.description, 500), position };
  }).filter(image => Boolean(image.url || image.description));
  const invalid = images.find(image => !image.url || !validUrl(image.url));
  if (invalid) return NextResponse.json({ error: "Every redesign needs a complete http:// or https:// image URL." }, { status: 400 });
  if (images.some(image => image.suppliedId && !uuidPattern.test(image.suppliedId))) return NextResponse.json({ error: "One redesign image has an invalid identifier. Refresh and try again." }, { status: 400 });

  const suppliedIds = images.filter(image => image.suppliedId).map(image => image.id);
  const [leadRows, originals, owned] = await Promise.all([
    sql`SELECT id, collage_original_image_id FROM leads WHERE id=${id}`,
    sql`SELECT id FROM lead_images WHERE lead_id=${id} ORDER BY position, created_at`,
    suppliedIds.length ? sql`SELECT id FROM redesign_images WHERE lead_id=${id} AND id = ANY(${suppliedIds}::uuid[])` : Promise.resolve([]),
  ]);
  if (!leadRows[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  if (owned.length !== suppliedIds.length) return NextResponse.json({ error: "A redesign image no longer belongs to this business. Refresh and try again." }, { status: 409 });

  const originalIds = new Set(originals.map(row => String(row.id)));
  const requestedOriginal = clean(body.collageOriginalImageId, 36);
  if (requestedOriginal && (!uuidPattern.test(requestedOriginal) || !originalIds.has(requestedOriginal))) return NextResponse.json({ error: "Choose an original creative from this business." }, { status: 400 });
  const currentOriginal = leadRows[0].collage_original_image_id ? String(leadRows[0].collage_original_image_id) : "";
  const selectedOriginal = originals.length === 1 ? String(originals[0].id) : requestedOriginal || (originalIds.has(currentOriginal) ? currentOriginal : "");
  const imagesJson = JSON.stringify(images.map(({ id: imageId, url, description, position }) => ({ id: imageId, url, description, position })));
  const nextStatus = images.length > 0 && ["research_pending", "research_completed"].includes(body.workflowStatus) ? "redesign_created" : body.workflowStatus;
  const chatgptUrl = clean(body.chatgptUrl, 4_000);
  if (chatgptUrl && !validUrl(chatgptUrl)) return NextResponse.json({ error: "ChatGPT URL must start with http:// or https://." }, { status: 400 });

  const result = await sql`WITH payload AS (
    SELECT * FROM jsonb_to_recordset(${imagesJson}::jsonb) AS image(id uuid, url text, description text, position integer)
  ), updated AS (
    UPDATE leads SET admin_notes=${clean(body.adminNotes, 10_000) || null}, chatgpt_url=${chatgptUrl || null}, workflow_status=${nextStatus}, collage_original_image_id=${selectedOriginal || null}::uuid, updated_at=now()
    WHERE id=${id} RETURNING id, workflow_status, collage_original_image_id
  ), upserted AS (
    INSERT INTO redesign_images (id, lead_id, url, description, position, collage_status, collage_requested_at)
    SELECT image.id, updated.id, image.url, NULLIF(image.description, ''), image.position, CASE WHEN ${Boolean(selectedOriginal)} THEN 'queued' ELSE 'waiting' END, CASE WHEN ${Boolean(selectedOriginal)} THEN now() ELSE NULL END
    FROM updated CROSS JOIN payload image
    ON CONFLICT (id) DO UPDATE SET
      url=EXCLUDED.url, description=EXCLUDED.description, position=EXCLUDED.position,
      collage_status=CASE
        WHEN ${!selectedOriginal} THEN 'waiting'
        WHEN redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid OR redesign_images.collage_source_redesign_url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_status='waiting' THEN 'queued'
        WHEN redesign_images.collage_status='processing' AND redesign_images.collage_started_at < now() - interval '2 minutes' THEN 'failed'
        ELSE redesign_images.collage_status
      END,
      collage_url=CASE WHEN redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid THEN NULL ELSE redesign_images.collage_url END,
      collage_error=CASE WHEN redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid THEN NULL ELSE redesign_images.collage_error END,
      collage_requested_at=CASE WHEN ${Boolean(selectedOriginal)} AND (redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid OR redesign_images.collage_status='waiting') THEN now() ELSE redesign_images.collage_requested_at END,
      collage_started_at=CASE WHEN redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid THEN NULL ELSE redesign_images.collage_started_at END,
      collage_completed_at=CASE WHEN redesign_images.url IS DISTINCT FROM EXCLUDED.url OR redesign_images.collage_source_image_id IS DISTINCT FROM ${selectedOriginal || null}::uuid THEN NULL ELSE redesign_images.collage_completed_at END
    WHERE redesign_images.lead_id=EXCLUDED.lead_id
    RETURNING id, url, description, position, collage_url, collage_status, collage_error
  ), deleted AS (
    DELETE FROM redesign_images r WHERE r.lead_id IN (SELECT id FROM updated) AND NOT EXISTS (SELECT 1 FROM payload WHERE payload.id=r.id) RETURNING r.id
  )
  SELECT updated.id, updated.workflow_status, updated.collage_original_image_id,
    COALESCE(json_agg(json_build_object('id', upserted.id, 'url', upserted.url, 'description', upserted.description, 'collageUrl', upserted.collage_url, 'collageStatus', upserted.collage_status, 'collageError', upserted.collage_error) ORDER BY upserted.position) FILTER (WHERE upserted.id IS NOT NULL), '[]') AS redesign_images
  FROM updated LEFT JOIN upserted ON true GROUP BY updated.id, updated.workflow_status, updated.collage_original_image_id`;
  if (!result[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  const savedImages = result[0].redesign_images as SavedImage[];
  if (savedImages.some(image => image.collageStatus === "queued")) after(() => processCollageQueue(id));
  return NextResponse.json({ saved: true, workflowStatus: result[0].workflow_status, collageOriginalImageId: result[0].collage_original_image_id, redesignImages: savedImages, collageQueued: savedImages.some(image => image.collageStatus === "queued") });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await sql`DELETE FROM leads WHERE id=${id} RETURNING id`;
  if (!result[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
