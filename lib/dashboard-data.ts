import { sql, type SessionUser } from "@/lib/db";
import { isWorkflowStatus, type WorkflowStatus } from "@/lib/workflow";

export const DASHBOARD_PAGE_SIZE = 20;
export type DashboardFilter = "all" | "pending" | "completed" | "completed_research" | WorkflowStatus;

export function normalizeDashboardFilter(value: unknown, role: SessionUser["role"]): DashboardFilter {
  const filter = String(value ?? "all");
  if (role === "admin" && (filter === "completed_research" || isWorkflowStatus(filter))) return filter;
  if (role === "employee" && ["pending", "completed"].includes(filter)) return filter as "pending" | "completed";
  return "all";
}

export async function getDashboardData(user: SessionUser, input: { page?: unknown; filter?: unknown; search?: unknown }) {
  let page = Math.max(1, Math.min(10_000, Number.parseInt(String(input.page ?? "1"), 10) || 1));
  const filter = normalizeDashboardFilter(input.filter, user.role);
  const search = String(input.search ?? "").trim().slice(0, 120);
  const pattern = `%${search}%`;
  const workflowFilter = isWorkflowStatus(filter);
  const workflowValue = workflowFilter ? filter : "research_pending";
  const loadRows = (requestedPage: number) => sql`SELECT l.id, l.ad_url, l.title, l.status, l.facebook_url, l.instagram_url,
    l.email, l.phone, l.has_website, l.website_status, l.website_url, l.notes, l.created_by,
    l.completed_by, l.completed_at, l.created_at, l.updated_at, l.draft_by, l.draft_updated_at,
    l.workflow_status, u.name AS completed_by_name, d.name AS draft_by_name,
    (COUNT(*) OVER())::int AS filtered_count,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id = l.id), '[]') AS images
    FROM leads l LEFT JOIN users u ON u.id = l.completed_by LEFT JOIN users d ON d.id = l.draft_by
    WHERE (${search === ""} OR (COALESCE(l.title,'') || ' ' || l.ad_url || ' ' || COALESCE(l.email,'')) ILIKE ${pattern})
      AND (${filter === "all"}
        OR (${filter === "completed_research"} AND l.status='completed')
        OR (${filter === "pending"} AND l.status='pending')
        OR (${filter === "completed"} AND l.status='completed')
        OR (${workflowFilter} AND l.workflow_status=${workflowValue}))
    ORDER BY (l.status='pending') DESC, l.created_at DESC, l.id DESC
    LIMIT ${DASHBOARD_PAGE_SIZE} OFFSET ${(requestedPage - 1) * DASHBOARD_PAGE_SIZE}`;

  const [initialRows, summaryRows, userRows] = await Promise.all([
    loadRows(page),
    sql`SELECT
      (COUNT(*) FILTER (WHERE status='pending'))::int AS pending_count,
      (COUNT(*) FILTER (WHERE status='completed' AND (${user.role === "admin"} OR completed_by=${user.id}) AND EXISTS (SELECT 1 FROM lead_images i WHERE i.lead_id=leads.id AND NULLIF(BTRIM(i.url),'') IS NOT NULL)))::int AS paid_count
      FROM leads`,
    user.role === "admin" ? sql`SELECT u.id, u.username, u.name, u.role, u.active, u.created_at,
      (COUNT(l.id) FILTER (WHERE l.status='completed' AND EXISTS (SELECT 1 FROM lead_images i WHERE i.lead_id=l.id AND NULLIF(BTRIM(i.url),'') IS NOT NULL)))::int AS paid_count
      FROM users u LEFT JOIN leads l ON l.completed_by=u.id GROUP BY u.id ORDER BY u.created_at DESC` : Promise.resolve([]),
  ]);
  let rows = initialRows;
  if (!rows.length && page > 1) { page = 1; rows = await loadRows(page); }
  const total = Number(rows[0]?.filtered_count ?? 0);
  const leads = rows.map((row) => {
    const lead = { ...row };
    delete lead.filtered_count;
    return lead;
  });
  return { leads, users: userRows, page, pageSize: DASHBOARD_PAGE_SIZE, total, filter, search, summary: { pending: Number(summaryRows[0]?.pending_count ?? 0), paid: Number(summaryRows[0]?.paid_count ?? 0) } };
}
