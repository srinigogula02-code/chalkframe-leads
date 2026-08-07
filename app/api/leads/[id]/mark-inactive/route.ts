import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

/** Any logged-in user (admin or employee) can mark a lead as ad_inactive */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await sql`
    UPDATE leads
    SET workflow_status = 'ad_inactive', updated_at = now()
    WHERE id = ${id}
    RETURNING id, title, workflow_status
  `;

  if (!rows[0]) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ ok: true, lead: rows[0] });
}
