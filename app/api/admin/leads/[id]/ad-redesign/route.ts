import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processAdCreativeImage } from "@/lib/ad-creative-processor";
import { processCollageQueue } from "@/lib/collage";
import { sql } from "@/lib/db";
import { generateAdRedesign } from "@/lib/openrouter-ad-redesign";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function resolveSourceImageId(leadId: string, sourceImageId?: string, sourceImageUrl?: string) {
  if (sourceImageId) {
    const rows = await sql`SELECT id FROM lead_images WHERE id=${sourceImageId} AND lead_id=${leadId} LIMIT 1`;
    if (!rows[0]) throw new Error("The selected creative no longer belongs to this business. Refresh the page and try again.");
    return String(rows[0].id);
  }
  const url = sourceImageUrl?.trim();
  if (url) {
    const existing = await sql`SELECT id FROM lead_images WHERE lead_id=${leadId} AND url=${url} LIMIT 1`;
    if (existing[0]) return String(existing[0].id);
    const processed = await processAdCreativeImage(url);
    const positionRows = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM lead_images WHERE lead_id=${leadId}`;
    const inserted = await sql`INSERT INTO lead_images (lead_id, url, description, position)
      SELECT ${leadId}, ${processed.url}, 'Source creative added for AI redesign', ${Number(positionRows[0].position)}
      WHERE EXISTS (SELECT 1 FROM leads WHERE id=${leadId})
      RETURNING id`;
    if (!inserted[0]) throw new Error("Business lead not found.");
    return String(inserted[0].id);
  }
  const first = await sql`SELECT id FROM lead_images WHERE lead_id=${leadId} ORDER BY position ASC LIMIT 1`;
  if (!first[0]) throw new Error("Add an original ad creative before generating a redesign.");
  return String(first[0].id);
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: leadId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { sourceImageUrl?: unknown; sourceImageId?: unknown; redesignAll?: unknown };
  const sourceImageId = typeof body.sourceImageId === "string" ? body.sourceImageId.trim() : "";
  const sourceImageUrl = typeof body.sourceImageUrl === "string" ? body.sourceImageUrl.trim() : "";

  try {
    if (body.redesignAll === true) {
      const images = await sql`SELECT id FROM lead_images WHERE lead_id=${leadId} ORDER BY position ASC`;
      if (!images.length) return NextResponse.json({ error: "Add an original ad creative before generating redesigns." }, { status: 400 });
      
      // Non-blocking background queueing for Vercel free plan compatibility
      after(async () => {
        for (const image of images) {
          try {
            await generateAdRedesign({ leadId, sourceImageId: String(image.id), trigger: "manual" });
          } catch (err) {
            console.error("[Ad Redesign Background All Error]", err);
          }
        }
        processCollageQueue(leadId);
      });

      return NextResponse.json({ ok: true, queued: true, message: `Queued redesigns for ${images.length} creative(s) in background.` }, { status: 202 });
    }

    const resolvedSourceImageId = await resolveSourceImageId(leadId, sourceImageId || undefined, sourceImageUrl || undefined);
    
    // Non-blocking background queueing for single creative redesign
    after(async () => {
      try {
        await generateAdRedesign({ leadId, sourceImageId: resolvedSourceImageId, trigger: "manual" });
        processCollageQueue(leadId);
      } catch (err) {
        console.error("[Ad Redesign Background Single Error]", err);
      }
    });

    return NextResponse.json({ ok: true, queued: true, message: "AI ad redesign queued in background." }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ad redesign generation failed." }, { status: 502 });
  }
}
