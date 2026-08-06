import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processCollageQueue } from "@/lib/collage";
import { sql } from "@/lib/db";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { originalImageId?: unknown; retry?: unknown };
  const [leadRows, originals] = await Promise.all([
    sql`SELECT id, collage_original_image_id FROM leads WHERE id=${id}`,
    sql`SELECT id FROM lead_images WHERE lead_id=${id} ORDER BY position, created_at`,
  ]);
  if (!leadRows[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  if (!originals.length) return NextResponse.json({ error: "Add an original ad creative before creating a collage." }, { status: 409 });
  const ids = new Set(originals.map(row => String(row.id)));
  const requested = String(body.originalImageId ?? "").trim();
  if (requested && (!uuidPattern.test(requested) || !ids.has(requested))) return NextResponse.json({ error: "Choose an original creative from this business." }, { status: 400 });
  const current = leadRows[0].collage_original_image_id ? String(leadRows[0].collage_original_image_id) : "";
  const selected = originals.length === 1 ? String(originals[0].id) : requested || (ids.has(current) ? current : "");
  if (!selected) return NextResponse.json({ error: "Choose which original creative to use in the collage." }, { status: 409 });

  await sql.transaction([
    sql`UPDATE leads SET collage_original_image_id=${selected}, updated_at=now() WHERE id=${id}`,
    sql`UPDATE redesign_images SET collage_status='queued', collage_error=NULL, collage_url=CASE WHEN collage_source_image_id IS DISTINCT FROM ${selected}::uuid OR collage_source_redesign_url IS DISTINCT FROM url THEN NULL ELSE collage_url END,
      collage_requested_at=now(), collage_started_at=NULL, collage_completed_at=CASE WHEN collage_source_image_id IS DISTINCT FROM ${selected}::uuid OR collage_source_redesign_url IS DISTINCT FROM url THEN NULL ELSE collage_completed_at END
      WHERE lead_id=${id} AND (collage_source_image_id IS DISTINCT FROM ${selected}::uuid OR collage_source_redesign_url IS DISTINCT FROM url OR collage_status IN ('waiting','failed') OR (collage_status='completed' AND collage_url IS NULL) OR (${Boolean(body.retry)} AND collage_status='processing' AND collage_started_at < now() - interval '2 minutes'))`,
  ]);
  after(() => processCollageQueue(id));
  return NextResponse.json({ queued: true, collageOriginalImageId: selected });
}
