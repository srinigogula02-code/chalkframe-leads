import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import Dashboard from "./dashboard";
import type { Lead, TeamUser } from "./dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; q?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  const query = await searchParams;
  const data = await getDashboardData(user, { page: query.page, filter: query.status, search: query.q });
  return <Dashboard initialLeads={data.leads as unknown as Lead[]} initialUsers={data.users as unknown as TeamUser[]} user={user} initialTab={data.filter} initialSearch={data.search} initialPage={data.page} initialTotal={data.total} initialSummary={data.summary}/>;
}
