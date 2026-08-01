import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, CheckCircle2, LayoutGrid, LogOut, SearchX, Users } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ResearchCompletedEntryPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const rows = await sql`SELECT id FROM leads WHERE workflow_status='research_completed' ORDER BY created_at DESC LIMIT 1`;
  if (rows[0]) redirect(`/dashboard/leads/${rows[0].id}?status=research_completed`);
  return <main className="app-shell">
    <aside className="sidebar"><img src="/brand/chalkframe-logo-dark.svg" alt="Chalkframe" className="side-logo"/><nav><Link className="nav-item" href="/dashboard"><LayoutGrid size={18}/>Leads</Link><Link className="nav-item active" href="/dashboard/research-completed"><CheckCircle2 size={18}/>Research completed</Link><Link className="nav-item" href="/dashboard/stats"><BarChart3 size={18}/>Stats</Link><Link className="nav-item" href="/dashboard#team"><Users size={18}/>Team earnings</Link></nav><div className="side-bottom"><div className="user-chip"><span>{user.name.charAt(0)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div><form action={logoutAction}><button className="logout" aria-label="Sign out"><LogOut size={17}/></button></form></div></aside>
    <section className="workspace phase-empty-workspace"><header className="topbar"><div><span className="technical">Chalkframe / Research completed</span><h1>Research completed</h1></div></header><section className="phase-empty"><span><SearchX size={25}/></span><strong>No business in this phase</strong><p>Businesses will appear here after an employee completes the research and before a redesign is created.</p><Link className="secondary-button" href="/dashboard">Return to all businesses</Link></section></section>
  </main>;
}
