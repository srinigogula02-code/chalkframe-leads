import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { processEmailDraftQueue, queueEmailDraftsForLead } from "@/lib/openrouter-email";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { redesignImageId?: unknown };
  const redesignImageId = String(body.redesignImageId || "").trim();
  if (!uuidPattern.test(redesignImageId)) return NextResponse.json({ error: "Choose a valid redesign collage." }, { status: 400 });
  const rows = await sql`SELECT r.id FROM redesign_images r WHERE r.id=${redesignImageId} AND r.lead_id=${id} AND r.collage_status='completed' AND r.collage_url IS NOT NULL`;
  if (!rows[0]) return NextResponse.json({ error: "The selected collage is not ready for email generation." }, { status: 409 });
  const queued = await queueEmailDraftsForLead(id, { redesignImageId, force: true, trigger: "regenerate" });
  if (!queued.enabled) return NextResponse.json({ error: "AI email generation is paused in settings." }, { status: 409 });
  after(() => processEmailDraftQueue(id));
  return NextResponse.json({ queued: true });
}
