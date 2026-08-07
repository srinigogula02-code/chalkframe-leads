import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Mail, Send, AlertTriangle, Cpu } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";
import DashboardSidebar from "../sidebar";

export const dynamic = "force-dynamic";

type CountRow = { workflow_status: WorkflowStatus; count: string };
type ExtensionStatsRow = { added_count: string; duplicate_count: string; today_added: string; today_duplicates: string; last_attempt_at: string | null };
type EmailStatsSummary = { total_sent: string; today_sent: string; successful_sent: string; failed_sent: string };
type SentEmailRow = { id: string; recipient_email: string; sender_email: string; subject: string; status: string; resend_id: string | null; sent_at: string; lead_title: string | null };
type AiRedesignStats = { total: string; completed: string; failed: string; total_cost_usd: string; avg_cost_usd: string };

const PHASE_COPY: Record<WorkflowStatus, string> = {
  research_pending: "Waiting for an employee to add business research.",
  ad_inactive: "Ad went inactive — parked for now, can be re-activated.",
  research_completed: "Research is ready for admin review and redesign.",
  redesign_created: "A redesigned creative has been added.",
  contacted: "The business has been contacted manually or via Resend email.",
};

export default async function StatsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const [rows, extensionRows, sentSummaryRows, sentHistory, aiRedesignRows] = await Promise.all([
    sql`SELECT workflow_status, COUNT(*)::text AS count FROM leads GROUP BY workflow_status` as unknown as Promise<CountRow[]>,
    sql`SELECT COALESCE(SUM(added_count), 0)::text AS added_count,
      COALESCE(SUM(duplicate_count), 0)::text AS duplicate_count,
      COALESCE(SUM(added_count) FILTER (WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS today_added,
      COALESCE(SUM(duplicate_count) FILTER (WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS today_duplicates,
      MAX(last_attempt_at)::text AS last_attempt_at
      FROM extension_capture_stats` as unknown as Promise<ExtensionStatsRow[]>,
    sql`SELECT COUNT(*)::text AS total_sent,
      COUNT(*) FILTER (WHERE sent_at >= date_trunc('day', now()))::text AS today_sent,
      COUNT(*) FILTER (WHERE status='sent')::text AS successful_sent,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed_sent
      FROM sent_emails` as unknown as Promise<EmailStatsSummary[]>,
    sql`SELECT s.id, s.recipient_email, s.sender_email, s.subject, s.status, s.resend_id, s.sent_at, l.title as lead_title
      FROM sent_emails s LEFT JOIN leads l ON l.id=s.lead_id ORDER BY s.sent_at DESC LIMIT 20` as unknown as Promise<SentEmailRow[]>,
    sql`SELECT COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE status='completed')::text AS completed,
      COUNT(*) FILTER (WHERE status='failed')::text AS failed,
      COALESCE(SUM(cost_usd), 0)::numeric(10,6)::text AS total_cost_usd,
      COALESCE(AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL AND status='completed'), 0)::numeric(10,6)::text AS avg_cost_usd
      FROM lead_ad_redesign_runs` as unknown as Promise<AiRedesignStats[]>,
  ]);

  // Fetch OpenRouter balance
  let openRouterBalance: number | null = null;
  let openRouterLimit: number | null = null;
  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      next: { revalidate: 0 },
    });
    if (orRes.ok) {
      const orData = await orRes.json() as { data?: { usage?: number; limit?: number | null } };
      openRouterBalance = typeof orData.data?.usage === "number" ? orData.data.usage : null;
      openRouterLimit = orData.data?.limit ?? null;
    }
  } catch { /* silent — show n/a if fetch fails */ }

  const counts = Object.fromEntries(WORKFLOW_STATUSES.map(status => [status, Number(rows.find(row => row.workflow_status === status)?.count ?? 0)])) as Record<WorkflowStatus, number>;
  const total = WORKFLOW_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const largest = WORKFLOW_STATUSES.reduce((current, status) => counts[status] > counts[current] ? status : current, WORKFLOW_STATUSES[0]);
  const progressed = counts.redesign_created + counts.contacted;
  const extension = extensionRows[0] ?? { added_count: "0", duplicate_count: "0", today_added: "0", today_duplicates: "0", last_attempt_at: null };
  const captured = Number(extension.added_count) + Number(extension.duplicate_count);
  const duplicateRate = captured ? Math.round(Number(extension.duplicate_count) / captured * 100) : 0;
  const lastAttempt = extension.last_attempt_at ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(extension.last_attempt_at)) : "No extension activity yet";

  const emailSummary = sentSummaryRows[0] ?? { total_sent: "0", today_sent: "0", successful_sent: "0", failed_sent: "0" };
  const aiStats = aiRedesignRows[0] ?? { total: "0", completed: "0", failed: "0", total_cost_usd: "0", avg_cost_usd: "0" };
  const orSpent = openRouterBalance !== null ? `$${openRouterBalance.toFixed(4)}` : "N/A";
  const orRemaining = openRouterLimit !== null && openRouterBalance !== null
    ? `$${(openRouterLimit - openRouterBalance).toFixed(4)} remaining`
    : openRouterLimit === null ? "Unlimited / prepaid" : "N/A";

  return (
    <main className="app-shell stats-shell">
      <DashboardSidebar user={user} active="stats" />
      <section className="workspace stats-workspace">
        <header className="topbar stats-topbar">
          <div>
            <span className="technical">Chalkframe / Pipeline</span>
            <h1>Business & Email Stats</h1>
            <p>Workflow stage tracking, Chrome extension activity, and Resend outreach performance.</p>
          </div>
          <Link className="secondary-button" href="/dashboard">
            View businesses
          </Link>
        </header>

        <section className="stats-summary" aria-label="Pipeline summary">
          <div>
            <span className="technical">All businesses</span>
            <strong>{total.toLocaleString("en-IN")}</strong>
            <small>records in workspace</small>
          </div>
          <div>
            <span className="technical">Past research</span>
            <strong>{progressed.toLocaleString("en-IN")}</strong>
            <small>{total ? Math.round((progressed / total) * 100) : 0}% redesigned/contacted</small>
          </div>
          <div>
            <span className="technical">Ad Inactive</span>
            <strong style={{ color: counts.ad_inactive > 0 ? "#f59e0b" : "inherit" }}>
              {counts.ad_inactive.toLocaleString("en-IN")}
            </strong>
            <small>{total ? Math.round((counts.ad_inactive / total) * 100) : 0}% parked leads</small>
          </div>
          <div>
            <span className="technical">Resend Emails Sent</span>
            <strong>{Number(emailSummary.total_sent).toLocaleString("en-IN")}</strong>
            <small>{Number(emailSummary.today_sent).toLocaleString("en-IN")} sent today</small>
          </div>
          <div className="stats-attention">
            <span className="technical">Largest phase</span>
            <strong>{WORKFLOW_LABELS[largest]}</strong>
            <small>{counts[largest].toLocaleString("en-IN")} businesses</small>
          </div>
        </section>

        {/* AI Ad Redesign Stats */}
        <section className="extension-stats" aria-label="AI Ad Redesign Stats" style={{ marginTop: "24px" }}>
          <div className="extension-stats-heading">
            <div>
              <span className="technical">OpenRouter · AI Image Generation</span>
              <h2>AI Ad Redesign Usage</h2>
            </div>
            <Link href="/dashboard/ai-ad-redesigns" style={{ fontSize: "13px", fontWeight: 600, color: "#f59e0b", textDecoration: "underline" }}>
              View AI Redesigns →
            </Link>
          </div>
          <div className="extension-stat-grid">
            <article>
              <span>Total Generations</span>
              <strong>{Number(aiStats.total).toLocaleString("en-IN")}</strong>
              <small>{Number(aiStats.completed).toLocaleString("en-IN")} completed · {Number(aiStats.failed).toLocaleString("en-IN")} failed</small>
            </article>
            <article>
              <span>Total Cost Spent</span>
              <strong>${Number(aiStats.total_cost_usd).toFixed(4)}</strong>
              <small>Via OpenRouter API</small>
            </article>
            <article>
              <span>Avg Cost / Generation</span>
              <strong>${Number(aiStats.avg_cost_usd).toFixed(4)}</strong>
              <small>Per completed redesign</small>
            </article>
            <article className={openRouterLimit !== null && openRouterBalance !== null && (openRouterLimit - openRouterBalance) < 1 ? "duplicates-prevented" : ""}>
              <span>OpenRouter Balance</span>
              <strong>{orSpent} used</strong>
              <small>{orRemaining}</small>
            </article>
          </div>
        </section>

        {/* Resend Email Outreach Performance */}
        <section className="extension-stats" aria-label="Resend Email Performance" style={{ marginTop: "24px" }}>
          <div className="extension-stats-heading">
            <div>
              <span className="technical">Resend Email System</span>
              <h2>Outreach Delivery Activity</h2>
            </div>
            <Link href="/dashboard/email-template" style={{ fontSize: "13px", fontWeight: 600, color: "#f59e0b", textDecoration: "underline" }}>
              Customize Email Template →
            </Link>
          </div>
          <div className="extension-stat-grid">
            <article>
              <span>Total Emails Delivered</span>
              <strong>{Number(emailSummary.successful_sent).toLocaleString("en-IN")}</strong>
              <small>{Number(emailSummary.today_sent).toLocaleString("en-IN")} dispatched today</small>
            </article>
            <article>
              <span>Delivery Success Rate</span>
              <strong>
                {Number(emailSummary.total_sent)
                  ? Math.round((Number(emailSummary.successful_sent) / Number(emailSummary.total_sent)) * 100)
                  : 100}
                %
              </strong>
              <small>Via Resend API</small>
            </article>
            <article className="duplicates-prevented">
              <span>Delivery Failures</span>
              <strong>{Number(emailSummary.failed_sent).toLocaleString("en-IN")}</strong>
              <small>Logged in error audit</small>
            </article>
          </div>

          {sentHistory.length > 0 && (
            <div style={{ marginTop: "20px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "13px", color: "#334155" }}>
                Recent Sent Emails History
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left", background: "#f1f5f9", color: "#475569" }}>
                    <th style={{ padding: "8px 12px" }}>Recipient</th>
                    <th style={{ padding: "8px 12px" }}>Lead / Business</th>
                    <th style={{ padding: "8px 12px" }}>Subject Line</th>
                    <th style={{ padding: "8px 12px" }}>Resend ID</th>
                    <th style={{ padding: "8px 12px" }}>Status</th>
                    <th style={{ padding: "8px 12px" }}>Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {sentHistory.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{item.recipient_email}</td>
                      <td style={{ padding: "8px 12px", color: "#475569" }}>{item.lead_title || "Lead"}</td>
                      <td style={{ padding: "8px 12px", color: "#334155" }}>{item.subject}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "12px", color: "#64748b" }}>{item.resend_id || "-"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: item.status === "sent" ? "#ecfdf5" : "#fef2f2",
                            color: item.status === "sent" ? "#047857" : "#b91c1c",
                          }}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "12px", color: "#64748b" }}>
                        {new Date(item.sent_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="extension-stats" aria-label="Chrome extension activity">
          <div className="extension-stats-heading">
            <div>
              <span className="technical">Chrome extension</span>
              <h2>Copy activity</h2>
            </div>
            <p>Last capture: {lastAttempt}</p>
          </div>
          <div className="extension-stat-grid">
            <article>
              <span>Links checked</span>
              <strong>{captured.toLocaleString("en-IN")}</strong>
              <small>{(Number(extension.today_added) + Number(extension.today_duplicates)).toLocaleString("en-IN")} today</small>
            </article>
            <article>
              <span>Businesses added</span>
              <strong>{Number(extension.added_count).toLocaleString("en-IN")}</strong>
              <small>{Number(extension.today_added).toLocaleString("en-IN")} today</small>
            </article>
            <article className="duplicates-prevented">
              <span>Duplicates prevented</span>
              <strong>{Number(extension.duplicate_count).toLocaleString("en-IN")}</strong>
              <small>
                {Number(extension.today_duplicates).toLocaleString("en-IN")} today · {duplicateRate}% of checks
              </small>
            </article>
          </div>
        </section>

        <section className="pipeline-panel">
          <div className="pipeline-heading">
            <div>
              <span className="technical">Live distribution</span>
              <h2>Businesses by phase</h2>
            </div>
            <span>Updated when this page loads</span>
          </div>
          <div className="phase-list">
            {WORKFLOW_STATUSES.map((status, index) => {
              const percentage = total ? Math.round((counts[status] / total) * 100) : 0;
              return (
                <article className={`phase-row phase-${status}`} key={status}>
                  <div className="phase-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="phase-name">
                    <strong>{WORKFLOW_LABELS[status]}</strong>
                    <span>{PHASE_COPY[status]}</span>
                  </div>
                  <div className="phase-measure">
                    <div>
                      <i style={{ width: `${percentage}%` }} />
                    </div>
                    <span>{percentage}%</span>
                  </div>
                  <strong className="phase-count">{counts[status].toLocaleString("en-IN")}</strong>
                  <Link prefetch={false} href={`/dashboard?status=${status}`} aria-label={`View ${WORKFLOW_LABELS[status]}`}>
                    <ArrowRight size={16} />
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
