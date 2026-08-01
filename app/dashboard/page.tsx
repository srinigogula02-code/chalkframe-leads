import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  const leads = await sql`SELECT l.*, u.name AS completed_by_name,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id = l.id), '[]') AS images
    FROM leads l LEFT JOIN users u ON u.id = l.completed_by ORDER BY CASE WHEN l.status = 'pending' THEN 0 ELSE 1 END, l.created_at DESC`;
  const users = user.role === "admin" ? await sql`SELECT id, username, name, role, active, created_at FROM users ORDER BY created_at DESC` : [];
  return <Dashboard initialLeads={leads as any[]} initialUsers={users as any[]} user={user} />;
}
