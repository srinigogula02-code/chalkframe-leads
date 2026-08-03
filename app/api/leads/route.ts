import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getDashboardData } from "@/lib/dashboard-data";
import { parseMetaAdLibraryUrl } from "@/lib/meta-ad";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const query = new URL(req.url).searchParams;
    const data = await getDashboardData(user, { page: query.get("page"), filter: query.get("status"), search: query.get("q") });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Dashboard data could not be loaded", error);
    return NextResponse.json({ error: "The dashboard could not be loaded." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { adUrl, title } = await req.json();
  const ad = parseMetaAdLibraryUrl(adUrl);
  if (!ad) return NextResponse.json({ error: "Use a Meta Ad Library link containing a valid ad ID." }, { status: 400 });
  try {
    const rows = await sql`INSERT INTO leads (ad_url, meta_ad_id, title, created_by) VALUES (${ad.canonicalUrl}, ${ad.adId}, ${String(title || "").trim().slice(0, 160) || null}, ${user.id}) ON CONFLICT (meta_ad_id) DO NOTHING RETURNING *, '[]'::json AS images`;
    if (!rows[0]) return NextResponse.json({ error: "This ad is already in Leads." }, { status: 409 });
    return NextResponse.json({ lead: rows[0] });
  } catch (error) {
    console.error("Dashboard lead capture failed", error);
    return NextResponse.json({ error: "The lead could not be added." }, { status: 500 });
  }
}
