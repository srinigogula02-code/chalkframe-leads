import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isWorkflowStatus } from "@/lib/workflow";

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const validUrl = (value: string) => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (!isWorkflowStatus(body.workflowStatus)) return NextResponse.json({ error: "Choose a valid business status." }, { status: 400 });
  const images = (Array.isArray(body.redesignImages) ? body.redesignImages : []).slice(0, 30).map((item: unknown) => {
    const image = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { url: clean(image.url, 4_000), description: clean(image.description, 500) };
  }).filter((image: { url: string; description: string }) => image.url || image.description);
  const invalid = images.find((image: { url: string }) => !image.url || !validUrl(image.url));
  if (invalid) return NextResponse.json({ error: "Every redesign needs a complete http:// or https:// image URL." }, { status: 400 });
  const imagesJson = JSON.stringify(images);
  const nextStatus = images.length > 0 && ["research_pending", "research_completed"].includes(body.workflowStatus) ? "redesign_created" : body.workflowStatus;
  const result = await sql`WITH updated AS (
    UPDATE leads SET admin_notes=${clean(body.adminNotes, 10_000) || null}, workflow_status=${nextStatus}, updated_at=now() WHERE id=${id} RETURNING id, workflow_status
  ), deleted AS (
    DELETE FROM redesign_images WHERE lead_id IN (SELECT id FROM updated) RETURNING lead_id
  ), inserted AS (
    INSERT INTO redesign_images (lead_id, url, description, position)
    SELECT updated.id, image.value->>'url', NULLIF(image.value->>'description', ''), image.position - 1 FROM updated CROSS JOIN jsonb_array_elements(${imagesJson}::jsonb) WITH ORDINALITY AS image(value, position) RETURNING lead_id
  ) SELECT id, workflow_status FROM updated`;
  if (!result[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  return NextResponse.json({ saved: true, workflowStatus: result[0].workflow_status });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await sql`WITH original_images AS (
    DELETE FROM lead_images WHERE lead_id=${id}
  ), redesigns AS (
    DELETE FROM redesign_images WHERE lead_id=${id}
  ) DELETE FROM leads WHERE id=${id} RETURNING id`;
  if (!result[0]) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
