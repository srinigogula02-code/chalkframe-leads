import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processCollageQueue } from "@/lib/collage";
import { sql } from "@/lib/db";
import { normalizeLeadDetails, validateCompletion } from "@/lib/lead-data";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const details = normalizeLeadDetails(await req.json());
  const validationError = validateCompletion(details);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const current = await sql`SELECT status, completed_by FROM leads WHERE id = ${id}`;
  if (!current[0]) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const ownsCompletion = current[0].status === "completed" && current[0].completed_by === user.id;
  if (current[0].status === "completed" && user.role !== "admin" && !ownsCompletion) return NextResponse.json({ error: "Only the employee who completed this business can edit it." }, { status: 403 });
  const imagesJson = JSON.stringify(details.images.filter(image => image.url));
  const isAdmin = user.role === "admin";
  const results = await sql`WITH updated AS (
    UPDATE leads SET facebook_url=${details.facebookUrl || null}, instagram_url=${details.instagramUrl || null}, email=${details.email || null}, phone=${details.phone || null}, website_status=${details.websiteStatus}, has_website=${details.websiteStatus === "yes"}, website_url=${details.websiteUrl || null}, notes=${details.notes || null}, status='completed', workflow_status=CASE WHEN workflow_status='research_pending' THEN 'research_completed' ELSE workflow_status END, completed_by=CASE WHEN status='completed' THEN completed_by ELSE ${user.id} END, completed_at=COALESCE(completed_at, now()), draft_by=NULL, draft_updated_at=NULL, updated_at=now()
    WHERE id=${id} AND (status='pending' OR ${isAdmin} OR completed_by=${user.id}) AND (${isAdmin} OR status='completed' OR draft_by IS NULL OR draft_by=${user.id} OR draft_updated_at < now() - interval '24 hours') RETURNING id
  ), deleted AS (
    DELETE FROM lead_images WHERE lead_id IN (SELECT id FROM updated) RETURNING lead_id
  ), inserted AS (
    INSERT INTO lead_images (lead_id, url, description, position)
    SELECT updated.id, image.value->>'url', NULLIF(image.value->>'description', ''), image.position - 1 FROM updated CROSS JOIN jsonb_array_elements(${imagesJson}::jsonb) WITH ORDINALITY AS image(value, position) RETURNING lead_id
  ) SELECT count(*)::int AS updated_count FROM updated`;
  if (results[0]?.updated_count !== 1) return NextResponse.json({ error: "This lead changed while you were working. Refresh and try again." }, { status: 409 });
  const originals = await sql`SELECT id FROM lead_images WHERE lead_id=${id} ORDER BY position, created_at`;
  const selectedOriginal = originals.length === 1 ? String(originals[0].id) : null;
  await sql.transaction([
    sql`UPDATE leads SET collage_original_image_id=${selectedOriginal}::uuid, updated_at=now() WHERE id=${id}`,
    sql`UPDATE redesign_images SET collage_url=NULL, collage_status=CASE WHEN ${Boolean(selectedOriginal)} THEN 'queued' ELSE 'waiting' END,
      collage_error=NULL, collage_source_image_id=NULL, collage_source_redesign_url=NULL,
      collage_requested_at=CASE WHEN ${Boolean(selectedOriginal)} THEN now() ELSE NULL END,
      collage_started_at=NULL, collage_completed_at=NULL WHERE lead_id=${id}`,
  ]);
  if (selectedOriginal) after(() => processCollageQueue(id));
  const rows = await sql`SELECT l.id, l.ad_url, l.title, l.status, l.facebook_url, l.instagram_url, l.email, l.phone, l.has_website, l.website_status, l.website_url, l.notes, l.created_by, l.completed_by, l.completed_at, l.created_at, l.updated_at, l.draft_by, l.draft_updated_at, l.workflow_status, u.name AS completed_by_name, d.name AS draft_by_name, COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id),'[]') AS images FROM leads l LEFT JOIN users u ON u.id=l.completed_by LEFT JOIN users d ON d.id=l.draft_by WHERE l.id=${id}`;
  return NextResponse.json({ lead: rows[0] });
}
