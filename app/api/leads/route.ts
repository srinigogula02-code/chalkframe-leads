import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { adUrl, title } = await req.json();
  try { new URL(adUrl); } catch { return NextResponse.json({ error: "Enter a valid ad URL." }, { status: 400 }); }
  const rows = await sql`INSERT INTO leads (ad_url, title, created_by) VALUES (${adUrl}, ${title || null}, ${user.id}) RETURNING *, '[]'::json AS images`;
  return NextResponse.json({ lead: rows[0] });
}
