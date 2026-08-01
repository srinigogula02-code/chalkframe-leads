import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { normalizeLeadDetails } from "@/lib/lead-data";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const details = normalizeLeadDetails(await req.json());
  const imagesJson = JSON.stringify(details.images);
  const isAdmin = user.role === "admin";

  const results = await sql`WITH updated AS (
    UPDATE leads SET facebook_url=${details.facebookUrl || null}, instagram_url=${details.instagramUrl || null}, email=${details.email || null}, phone=${details.phone || null}, website_status=${details.websiteStatus}, has_website=${details.websiteStatus === "yes"}, website_url=${details.websiteUrl || null}, notes=${details.notes || null}, draft_by=CASE WHEN draft_by IS NULL OR draft_updated_at < now() - interval '24 hours' THEN ${user.id} ELSE draft_by END, draft_updated_at=now(), updated_at=now()
    WHERE id=${id} AND status='pending' AND (${isAdmin} OR draft_by IS NULL OR draft_by=${user.id} OR draft_updated_at < now() - interval '24 hours') RETURNING id
  ), deleted AS (
    DELETE FROM lead_images WHERE lead_id IN (SELECT id FROM updated) RETURNING lead_id
  ), inserted AS (
    INSERT INTO lead_images (lead_id, url, description, position)
    SELECT updated.id, image.value->>'url', NULLIF(image.value->>'description', ''), image.position - 1 FROM updated CROSS JOIN jsonb_array_elements(${imagesJson}::jsonb) WITH ORDINALITY AS image(value, position) RETURNING lead_id
  ) SELECT count(*)::int AS updated_count FROM updated`;

  if (results[0]?.updated_count !== 1) return NextResponse.json({ error: "This lead is already complete or has an active draft from another team member." }, { status: 409 });
  const rows = await sql`SELECT l.id, l.ad_url, l.title, l.status, l.facebook_url, l.instagram_url, l.email, l.phone, l.has_website, l.website_status, l.website_url, l.notes, l.created_by, l.completed_by, l.completed_at, l.created_at, l.updated_at, l.draft_by, l.draft_updated_at, l.workflow_status, u.name AS completed_by_name, d.name AS draft_by_name, COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id),'[]') AS images FROM leads l LEFT JOIN users u ON u.id=l.completed_by LEFT JOIN users d ON d.id=l.draft_by WHERE l.id=${id}`;
  return NextResponse.json({ lead: rows[0], savedAt: new Date().toISOString() });
}
