import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params; const body = await req.json();
  const images = Array.isArray(body.images) ? body.images.slice(0, 30) : [];
  const current = await sql`SELECT status FROM leads WHERE id = ${id}`;
  if (!current[0]) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  if (current[0].status === "completed" && user.role !== "admin") return NextResponse.json({ error: "This lead is already complete." }, { status: 409 });
  await sql`UPDATE leads SET facebook_url=${body.facebookUrl||null}, instagram_url=${body.instagramUrl||null}, email=${body.email||null}, phone=${body.phone||null}, has_website=${Boolean(body.hasWebsite)}, website_url=${body.hasWebsite?body.websiteUrl||null:null}, notes=${body.notes||null}, status='completed', completed_by=COALESCE(completed_by, ${user.id}), completed_at=COALESCE(completed_at, now()), updated_at=now() WHERE id=${id}`;
  await sql`DELETE FROM lead_images WHERE lead_id=${id}`;
  for (let i=0;i<images.length;i++) await sql`INSERT INTO lead_images (lead_id,url,description,position) VALUES (${id},${images[i].url},${images[i].description||null},${i})`;
  const rows = await sql`SELECT l.*, u.name AS completed_by_name, COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id),'[]') AS images FROM leads l LEFT JOIN users u ON u.id=l.completed_by WHERE l.id=${id}`;
  return NextResponse.json({ lead: rows[0] });
}
