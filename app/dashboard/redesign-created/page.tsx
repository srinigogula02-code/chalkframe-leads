import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import DashboardSidebar from "../sidebar";

export const dynamic = "force-dynamic";

export default async function RedesignCreatedEntryPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const rows = await sql`SELECT id FROM leads WHERE workflow_status='redesign_created' ORDER BY created_at DESC LIMIT 1`;
  if (rows[0]) redirect(`/dashboard/redesign-created/${rows[0].id}`);
  return <main className="app-shell"><DashboardSidebar user={user} active="redesign"/><section className="workspace phase-empty-workspace"><header className="topbar"><div><span className="technical">Chalkframe / Redesign created</span><h1>Redesign created</h1></div></header><section className="phase-empty"><span><SearchX size={25}/></span><strong>No business in this phase</strong><p>Businesses will appear here after a redesign image is added and before they are marked as contacted.</p><Link className="secondary-button" href="/dashboard">Return to all businesses</Link></section></section></main>;
}
