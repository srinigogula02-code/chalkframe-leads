import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { generateAdRedesign } from "@/lib/openrouter-ad-redesign";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: leadId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    sourceImageUrl?: string;
    sourceImageId?: string;
  };

  let sourceImageUrl = String(body.sourceImageUrl || "").trim();
  let sourceImageId: string | null = body.sourceImageId ? String(body.sourceImageId) : null;

  if (sourceImageId && !sourceImageUrl) {
    const imgRows = await sql`SELECT url FROM lead_images WHERE id=${sourceImageId} AND lead_id=${leadId}`;
    if (imgRows[0]) {
      sourceImageUrl = String(imgRows[0].url);
    }
  }

  if (!sourceImageUrl) {
    const imgRows = await sql`SELECT id, url FROM lead_images WHERE lead_id=${leadId} ORDER BY position ASC LIMIT 1`;
    if (imgRows[0]) {
      sourceImageId = String(imgRows[0].id);
      sourceImageUrl = String(imgRows[0].url);
    }
  }

  if (!sourceImageUrl) {
    return NextResponse.json({ error: "An original ad creative image or URL is required." }, { status: 400 });
  }

  try {
    const result = await generateAdRedesign({
      leadId,
      sourceImageUrl,
      sourceImageId,
      trigger: "manual",
    });
    return NextResponse.json({ ok: true, redesign: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ad redesign generation failed." }, { status: 500 });
  }
}
