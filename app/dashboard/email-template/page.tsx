import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getEmailTemplateSettings } from "@/lib/resend-email";
import DashboardSidebar from "../sidebar";
import EmailTemplateClient from "./template-client";

export const dynamic = "force-dynamic";

export default async function EmailTemplatePage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const template = await getEmailTemplateSettings();

  return (
    <main className="app-shell ai-shell">
      <DashboardSidebar user={user} active="email_template" />
      <EmailTemplateClient initialTemplate={template} />
    </main>
  );
}
