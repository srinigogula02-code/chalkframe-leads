import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

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
