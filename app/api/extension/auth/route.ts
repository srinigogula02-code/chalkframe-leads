import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { createExtensionToken } from "@/lib/auth";
import { sql, type SessionUser } from "@/lib/db";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const rows = await sql`SELECT id, username, name, role, password_hash FROM users WHERE username=${username} AND active=true LIMIT 1`;
  const user = rows[0];
  if (!user || user.role !== "admin" || !(await compare(password, user.password_hash))) return NextResponse.json({ error: "Admin username or password is incorrect." }, { status: 401, headers: cors });
  const session: SessionUser = { id: String(user.id), username: String(user.username), name: String(user.name), role: "admin" };
  return NextResponse.json({ token: await createExtensionToken(session), user: { name: session.name, username: session.username }, expiresInDays: 30 }, { headers: cors });
}
