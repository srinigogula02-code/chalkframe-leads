import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isWorkflowStatus, type WorkflowStatus } from "@/lib/workflow";
import BusinessWorkspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const { id } = await params;
  const query = await searchParams;
  const statusFilter: WorkflowStatus | "all" = query.status === "completed_research" ? "research_completed" : isWorkflowStatus(query.status) ? query.status : "all";
  const rows = await sql`SELECT l.*, creator.name AS created_by_name, completer.name AS completed_by_name,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id), '[]') AS images,
    COALESCE((SELECT json_agg(json_build_object('id', r.id, 'url', r.url, 'description', r.description) ORDER BY r.position) FROM redesign_images r WHERE r.lead_id=l.id), '[]') AS redesign_images
    FROM leads l LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN users completer ON completer.id=l.completed_by WHERE l.id=${id}`;
  if (!rows[0]) notFound();
  if (statusFilter !== "all" && rows[0].workflow_status !== statusFilter) redirect(statusFilter === "research_completed" ? "/dashboard/research-completed" : `/dashboard?status=${statusFilter}`);
  const currentCreatedAt=rows[0].created_at;
  const filterValue=statusFilter==="all"?"research_pending":statusFilter;
  const [previous,next]=await Promise.all([
    sql`SELECT id FROM leads WHERE (${statusFilter==="all"} OR workflow_status=${filterValue}) AND (created_at>${currentCreatedAt} OR (created_at=${currentCreatedAt} AND id>${id})) ORDER BY created_at ASC,id ASC LIMIT 1`,
    sql`SELECT id FROM leads WHERE (${statusFilter==="all"} OR workflow_status=${filterValue}) AND (created_at<${currentCreatedAt} OR (created_at=${currentCreatedAt} AND id<${id})) ORDER BY created_at DESC,id DESC LIMIT 1`,
  ]);
  const previousId=previous[0]?.id?String(previous[0].id):null;
  const nextId=next[0]?.id?String(next[0].id):null;
  return <BusinessWorkspace lead={rows[0] as unknown as BusinessLead} previousId={previousId} nextId={nextId} statusFilter={statusFilter} />;
}

export type BusinessImage = { id?: string; url: string; description: string | null };
export type BusinessLead = {
  id:string; title:string|null; ad_url:string; status:"pending"|"completed"; workflow_status:WorkflowStatus;
  facebook_url:string|null; instagram_url:string|null; email:string|null; phone:string|null;
  website_status:"unknown"|"yes"|"no"; website_url:string|null; notes:string|null; admin_notes:string|null; chatgpt_url:string|null;
  images:BusinessImage[]; redesign_images:BusinessImage[]; completed_by_name:string|null; completed_at:string|null; created_at:string;
};
