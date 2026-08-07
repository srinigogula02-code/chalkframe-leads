import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getEmailTemplateSettings } from "@/lib/resend-email";

const clean = (val: unknown, max: number) => String(val ?? "").trim().slice(0, max);

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const template = await getEmailTemplateSettings();
  return NextResponse.json({ template });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const showCta = body.showCta !== false; // default true
  const ctaButtonText = clean(body.ctaButtonText, 80) || "View Interactive Ad Breakdown";
  const ctaButtonUrlOverride = clean(body.ctaButtonUrlOverride, 1000);
  const footerText = clean(body.footerText, 500) || "Chalkframe Performance Marketing. Scaling Meta ads with AI performance creatives.";
  const accentColor = clean(body.accentColor, 30) || "#f59e0b";

  const rows = await sql`UPDATE email_templates
    SET show_cta=${showCta},
        cta_button_text=${ctaButtonText},
        cta_button_url_override=${ctaButtonUrlOverride || null},
        footer_text=${footerText},
        accent_color=${accentColor},
        updated_at=now()
    WHERE id=1
    RETURNING id, show_cta, cta_button_text, cta_button_url_override, footer_text, accent_color, updated_at`;

  if (!rows[0]) return NextResponse.json({ error: "Email template settings not found." }, { status: 404 });
  return NextResponse.json({ saved: true, template: rows[0] });
}
