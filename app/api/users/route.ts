import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { username, name, password } = await req.json();
  if (!username || !name || !password || password.length < 8) return NextResponse.json({ error: "Name, username, and an 8-character password are required." }, { status: 400 });
  try {
    const passwordHash = await hash(password, 12);
    const rows = await sql`INSERT INTO users (username, name, password_hash, role) VALUES (${String(username).trim().toLowerCase()}, ${String(name).trim()}, ${passwordHash}, 'employee') RETURNING id, username, name, role, active, created_at`;
    return NextResponse.json({ user: rows[0] });
  } catch { return NextResponse.json({ error: "That username is already in use." }, { status: 409 }); }
}
