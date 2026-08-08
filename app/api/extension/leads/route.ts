import { after, NextResponse } from "next/server";
import { verifyExtensionToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { parseMetaAdLibraryUrl } from "@/lib/meta-ad";
import { processQueuedEnrichmentRuns, queueLeadEnrichment } from "@/lib/apify-enrichment";

export const maxDuration = 300;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const user = await verifyExtensionToken(token);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Connect the extension again." }, { status: 401, headers: cors });
  const body = await req.json().catch(() => ({}));
  const ad = parseMetaAdLibraryUrl(body.adUrl);
  if (!ad) return NextResponse.json({ error: "Copy a Meta Ad Library link containing a valid ad ID." }, { status: 400, headers: cors });
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 160) || null;

  try {
    const rows = await sql`WITH inserted AS (
      INSERT INTO leads (ad_url, meta_ad_id, title, created_by)
      VALUES (${ad.canonicalUrl}, ${ad.adId}, ${title}, ${user.id})
      ON CONFLICT (meta_ad_id) DO NOTHING
      RETURNING id
    ), tallied AS (
      INSERT INTO extension_capture_stats (day, user_id, added_count, duplicate_count, last_attempt_at)
      VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, ${user.id},
        CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN 1 ELSE 0 END,
        CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN 0 ELSE 1 END,
        now())
      ON CONFLICT (day, user_id) DO UPDATE SET
        added_count = extension_capture_stats.added_count + EXCLUDED.added_count,
        duplicate_count = extension_capture_stats.duplicate_count + EXCLUDED.duplicate_count,
        last_attempt_at = EXCLUDED.last_attempt_at
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM inserted) AS added,
      (SELECT id FROM inserted LIMIT 1) AS id
    FROM tallied`;
    const added = Boolean(rows[0]?.added);
    if (added && rows[0]?.id) {
      const enrichmentRunId = await queueLeadEnrichment(String(rows[0].id), "automatic").catch(error => {
        console.error("Extension Apify enrichment could not be queued", error);
        return null;
      });
      if (enrichmentRunId) after(() => processQueuedEnrichmentRuns(1));
    }
    return NextResponse.json({ added, duplicate: !added, id: rows[0]?.id ?? null }, { headers: cors });
  } catch (error) {
    console.error("Extension lead capture failed", error);
    return NextResponse.json({ error: "The ad could not be added." }, { status: 500, headers: cors });
  }
}
