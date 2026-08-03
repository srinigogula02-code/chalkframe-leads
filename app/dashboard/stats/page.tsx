import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";
import DashboardSidebar from "../sidebar";

export const dynamic = "force-dynamic";

type CountRow = { workflow_status: WorkflowStatus; count: string };
type ExtensionStatsRow = { added_count: string; duplicate_count: string; today_added: string; today_duplicates: string; last_attempt_at: string | null };

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

  const [rows, extensionRows] = await Promise.all([
    sql`SELECT workflow_status, COUNT(*)::text AS count FROM leads GROUP BY workflow_status` as unknown as Promise<CountRow[]>,
    sql`SELECT COALESCE(SUM(added_count), 0)::text AS added_count,
      COALESCE(SUM(duplicate_count), 0)::text AS duplicate_count,
      COALESCE(SUM(added_count) FILTER (WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS today_added,
      COALESCE(SUM(duplicate_count) FILTER (WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS today_duplicates,
      MAX(last_attempt_at)::text AS last_attempt_at
      FROM extension_capture_stats` as unknown as Promise<ExtensionStatsRow[]>,
  ]);
  const counts = Object.fromEntries(WORKFLOW_STATUSES.map(status => [status, Number(rows.find(row => row.workflow_status === status)?.count ?? 0)])) as Record<WorkflowStatus, number>;
  const total = WORKFLOW_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const largest = WORKFLOW_STATUSES.reduce((current, status) => counts[status] > counts[current] ? status : current, WORKFLOW_STATUSES[0]);
  const progressed = counts.redesign_created + counts.contacted;
  const extension = extensionRows[0] ?? { added_count: "0", duplicate_count: "0", today_added: "0", today_duplicates: "0", last_attempt_at: null };
  const captured = Number(extension.added_count) + Number(extension.duplicate_count);
  const duplicateRate = captured ? Math.round(Number(extension.duplicate_count) / captured * 100) : 0;
  const lastAttempt = extension.last_attempt_at ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(extension.last_attempt_at)) : "No extension activity yet";

  return <main className="app-shell stats-shell">
    <DashboardSidebar user={user} active="stats"/>
    <section className="workspace stats-workspace">
      <header className="topbar stats-topbar"><div><span className="technical">Chalkframe / Pipeline</span><h1>Business stats</h1><p>Current position of every business in the workflow.</p></div><Link className="secondary-button" href="/dashboard">View businesses</Link></header>
      <section className="stats-summary" aria-label="Pipeline summary"><div><span className="technical">All businesses</span><strong>{total.toLocaleString("en-IN")}</strong><small>records in the lead workspace</small></div><div><span className="technical">Past research</span><strong>{progressed.toLocaleString("en-IN")}</strong><small>{total ? Math.round(progressed / total * 100) : 0}% redesigned or contacted</small></div><div className="stats-attention"><span className="technical">Largest phase</span><strong>{WORKFLOW_LABELS[largest]}</strong><small>{counts[largest].toLocaleString("en-IN")} businesses currently here</small></div></section>
      <section className="extension-stats" aria-label="Chrome extension activity"><div className="extension-stats-heading"><div><span className="technical">Chrome extension</span><h2>Copy activity</h2></div><p>Last capture: {lastAttempt}</p></div><div className="extension-stat-grid"><article><span>Links checked</span><strong>{captured.toLocaleString("en-IN")}</strong><small>{(Number(extension.today_added) + Number(extension.today_duplicates)).toLocaleString("en-IN")} today</small></article><article><span>Businesses added</span><strong>{Number(extension.added_count).toLocaleString("en-IN")}</strong><small>{Number(extension.today_added).toLocaleString("en-IN")} today</small></article><article className="duplicates-prevented"><span>Duplicates prevented</span><strong>{Number(extension.duplicate_count).toLocaleString("en-IN")}</strong><small>{Number(extension.today_duplicates).toLocaleString("en-IN")} today · {duplicateRate}% of checks</small></article></div></section>
      <section className="pipeline-panel"><div className="pipeline-heading"><div><span className="technical">Live distribution</span><h2>Businesses by phase</h2></div><span>Updated when this page loads</span></div><div className="phase-list">{WORKFLOW_STATUSES.map((status, index) => { const percentage = total ? Math.round(counts[status] / total * 100) : 0; return <article className={`phase-row phase-${status}`} key={status}><div className="phase-index">{String(index + 1).padStart(2, "0")}</div><div className="phase-name"><strong>{WORKFLOW_LABELS[status]}</strong><span>{PHASE_COPY[status]}</span></div><div className="phase-measure"><div><i style={{ width: `${percentage}%` }}/></div><span>{percentage}%</span></div><strong className="phase-count">{counts[status].toLocaleString("en-IN")}</strong><Link prefetch={false} href={`/dashboard?status=${status}`} aria-label={`View ${WORKFLOW_LABELS[status]}`}><ArrowRight size={16}/></Link></article>; })}</div></section>
    </section>
  </main>;
}
