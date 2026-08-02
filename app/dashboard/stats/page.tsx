import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";
import DashboardSidebar from "../sidebar";

export const dynamic = "force-dynamic";

type CountRow = { workflow_status: WorkflowStatus; count: string };

const PHASE_COPY: Record<WorkflowStatus, string> = {
  research_pending: "Waiting for an employee to add business research.",
  research_completed: "Research is ready for admin review and redesign.",
  redesign_created: "A redesigned creative has been added.",
  contacted: "The business has been contacted manually.",
};

export default async function StatsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const rows = await sql`SELECT workflow_status, COUNT(*)::text AS count FROM leads GROUP BY workflow_status` as unknown as CountRow[];
  const counts = Object.fromEntries(WORKFLOW_STATUSES.map(status => [status, Number(rows.find(row => row.workflow_status === status)?.count ?? 0)])) as Record<WorkflowStatus, number>;
  const total = WORKFLOW_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const largest = WORKFLOW_STATUSES.reduce((current, status) => counts[status] > counts[current] ? status : current, WORKFLOW_STATUSES[0]);
  const progressed = counts.redesign_created + counts.contacted;

  return <main className="app-shell stats-shell">
    <DashboardSidebar user={user} active="stats"/>
    <section className="workspace stats-workspace">
      <header className="topbar stats-topbar"><div><span className="technical">Chalkframe / Pipeline</span><h1>Business stats</h1><p>Current position of every business in the workflow.</p></div><Link className="secondary-button" href="/dashboard">View businesses</Link></header>
      <section className="stats-summary" aria-label="Pipeline summary"><div><span className="technical">All businesses</span><strong>{total.toLocaleString("en-IN")}</strong><small>records in the lead workspace</small></div><div><span className="technical">Past research</span><strong>{progressed.toLocaleString("en-IN")}</strong><small>{total ? Math.round(progressed / total * 100) : 0}% redesigned or contacted</small></div><div className="stats-attention"><span className="technical">Largest phase</span><strong>{WORKFLOW_LABELS[largest]}</strong><small>{counts[largest].toLocaleString("en-IN")} businesses currently here</small></div></section>
      <section className="pipeline-panel"><div className="pipeline-heading"><div><span className="technical">Live distribution</span><h2>Businesses by phase</h2></div><span>Updated when this page loads</span></div><div className="phase-list">{WORKFLOW_STATUSES.map((status, index) => { const percentage = total ? Math.round(counts[status] / total * 100) : 0; return <article className={`phase-row phase-${status}`} key={status}><div className="phase-index">{String(index + 1).padStart(2, "0")}</div><div className="phase-name"><strong>{WORKFLOW_LABELS[status]}</strong><span>{PHASE_COPY[status]}</span></div><div className="phase-measure"><div><i style={{ width: `${percentage}%` }}/></div><span>{percentage}%</span></div><strong className="phase-count">{counts[status].toLocaleString("en-IN")}</strong><Link prefetch={false} href={`/dashboard?status=${status}`} aria-label={`View ${WORKFLOW_LABELS[status]}`}><ArrowRight size={16}/></Link></article>; })}</div></section>
    </section>
  </main>;
}
