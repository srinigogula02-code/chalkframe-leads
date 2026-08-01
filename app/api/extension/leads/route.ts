import { NextResponse } from "next/server";
import { verifyExtensionToken } from "@/lib/auth";
import { sql } from "@/lib/db";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const user = await verifyExtensionToken(token);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Connect the extension again." }, { status: 401, headers: cors });
  const body = await req.json().catch(() => ({}));
  let parsed: URL;
  try { parsed = new URL(String(body.adUrl)); } catch { return NextResponse.json({ error: "The copied text is not a valid URL." }, { status: 400, headers: cors }); }
  if (!(["facebook.com", "www.facebook.com"].includes(parsed.hostname)) || !parsed.pathname.startsWith("/ads/library")) return NextResponse.json({ error: "Copy a Meta Ad Library link." }, { status: 400, headers: cors });
  const adId = parsed.searchParams.get("id");
  if (!adId || !/^\d+$/.test(adId)) return NextResponse.json({ error: "The copied link does not contain a Meta ad ID." }, { status: 400, headers: cors });
  const canonicalUrl = `https://www.facebook.com/ads/library/?id=${adId}`;
  try {
    const rows = await sql`INSERT INTO leads (ad_url, title, created_by) VALUES (${canonicalUrl}, NULL, ${user.id}) RETURNING id`;
    return NextResponse.json({ added: true, id: rows[0].id }, { headers: cors });
  } catch (error) {
    if (String(error).includes("leads_ad_url_unique")) return NextResponse.json({ error: "This ad is already in Leads.", duplicate: true }, { status: 409, headers: cors });
    return NextResponse.json({ error: "The ad could not be added." }, { status: 500, headers: cors });
  }
}
