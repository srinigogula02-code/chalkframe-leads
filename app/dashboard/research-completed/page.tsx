import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ResearchCompletedEntryPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const rows = await sql`SELECT id FROM leads WHERE status='completed' ORDER BY created_at DESC LIMIT 1`;
  if (!rows[0]) redirect("/dashboard?status=research_completed");
  redirect(`/dashboard/leads/${rows[0].id}?status=completed_research`);
}
