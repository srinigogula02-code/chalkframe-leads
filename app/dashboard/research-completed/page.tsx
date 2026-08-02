import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import DashboardSidebar from "../sidebar";

export const dynamic = "force-dynamic";

export default async function ResearchCompletedEntryPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const rows = await sql`SELECT id FROM leads WHERE workflow_status='research_completed' ORDER BY created_at DESC LIMIT 1`;
  if (rows[0]) redirect(`/dashboard/leads/${rows[0].id}?status=research_completed`);
  return <main className="app-shell">
    <DashboardSidebar user={user} active="research"/>
    <section className="workspace phase-empty-workspace"><header className="topbar"><div><span className="technical">Chalkframe / Research completed</span><h1>Research completed</h1></div></header><section className="phase-empty"><span><SearchX size={25}/></span><strong>No business in this phase</strong><p>Businesses will appear here after an employee completes the research and before a redesign is created.</p><Link className="secondary-button" href="/dashboard">Return to all businesses</Link></section></section>
  </main>;
}
