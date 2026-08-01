import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await sql`UPDATE leads SET workflow_status='contacted', updated_at=now() WHERE id=${id} AND workflow_status='redesign_created' RETURNING id`;
  if (!result[0]) return NextResponse.json({ error: "This business is no longer in the Redesign created phase." }, { status: 409 });
  return NextResponse.json({ updated: true, workflowStatus: "contacted" });
}
