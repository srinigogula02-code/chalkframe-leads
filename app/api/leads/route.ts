import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getDashboardData } from "@/lib/dashboard-data";

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
  let parsed: URL;
  try { parsed = new URL(String(adUrl)); } catch { return NextResponse.json({ error: "Enter a valid Meta Ad Library URL." }, { status: 400 }); }
  if (!["facebook.com", "www.facebook.com"].includes(parsed.hostname) || !parsed.pathname.startsWith("/ads/library")) return NextResponse.json({ error: "Use a link copied from the Meta Ad Library." }, { status: 400 });
  try {
    const rows = await sql`INSERT INTO leads (ad_url, title, created_by) VALUES (${parsed.toString()}, ${String(title || "").trim().slice(0, 160) || null}, ${user.id}) RETURNING *, '[]'::json AS images`;
    return NextResponse.json({ lead: rows[0] });
  } catch (error) {
    if (String(error).includes("leads_ad_url_unique")) return NextResponse.json({ error: "This ad is already in the queue." }, { status: 409 });
    return NextResponse.json({ error: "The lead could not be added." }, { status: 500 });
  }
}
