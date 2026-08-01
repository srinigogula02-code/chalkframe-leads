import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import RedesignReview from "./review";

export const dynamic = "force-dynamic";

export type ReviewImage = { id: string; url: string; description: string | null };
export type RedesignLead = { id: string; title: string | null; ad_url: string; email: string | null; workflow_status: string; images: ReviewImage[]; redesign_images: ReviewImage[] };

export default async function RedesignCreatedBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  const { id } = await params;
  const rows = await sql`SELECT l.id, l.title, l.ad_url, l.email, l.workflow_status,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url, 'description', i.description) ORDER BY i.position) FROM lead_images i WHERE i.lead_id=l.id), '[]') AS images,
    COALESCE((SELECT json_agg(json_build_object('id', r.id, 'url', r.url, 'description', r.description) ORDER BY r.position) FROM redesign_images r WHERE r.lead_id=l.id), '[]') AS redesign_images
    FROM leads l WHERE l.id=${id}`;
  if (!rows[0]) notFound();
  if (rows[0].workflow_status !== "redesign_created") redirect("/dashboard/redesign-created");
  const navigation = await sql`SELECT id FROM leads WHERE workflow_status='redesign_created' ORDER BY created_at DESC`;
  const index = navigation.findIndex(item => item.id === id);
  const previousId = index > 0 ? String(navigation[index - 1].id) : null;
  const nextId = index >= 0 && index < navigation.length - 1 ? String(navigation[index + 1].id) : null;
  return <RedesignReview lead={rows[0] as unknown as RedesignLead} previousId={previousId} nextId={nextId}/>;
}
