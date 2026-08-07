import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  getEmailTemplateSettings,
  renderAdRedesignEmailHtml,
  renderPlainText,
} from "@/lib/resend-email";
import { Resend } from "resend";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leadId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    testTo?: string;
    subject?: string;
    bodyMarkdown?: string;
    collageUrl?: string | null;
  };

  const testTo = body.testTo?.trim();
  if (!testTo) return NextResponse.json({ error: "Test recipient email is required." }, { status: 400 });

  const subject = body.subject?.trim() || "Chalkframe · Ad Redesign Preview [TEST]";
  const bodyMarkdown = body.bodyMarkdown?.trim() || "This is a test email to preview the email layout.";

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured in environment variables." },
      { status: 503 },
    );
  }

  // Validate the lead belongs to this admin context
  const leads = await sql`SELECT id FROM leads WHERE id=${leadId} LIMIT 1`;
  if (!leads[0]) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const senderEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "Chalkframe <updates@chalkframe.work>";
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || undefined;

  const template = await getEmailTemplateSettings();
  const testSubject = `[TEST] ${subject}`;

  const htmlContent = renderAdRedesignEmailHtml({
    subject: testSubject,
    bodyText: bodyMarkdown,
    recipientEmail: testTo,
    collageUrl: body.collageUrl || null,
    template,
  });

  const plainText = renderPlainText({
    bodyText: bodyMarkdown,
    subject: testSubject,
    ctaUrl: template.cta_button_url_override || "https://chalkframe.com",
    ctaText: template.cta_button_text,
    footerText: template.footer_text,
    recipientEmail: testTo,
  });

  try {
    const resendClient = new Resend(apiKey);
    const result = await resendClient.emails.send({
      from: senderEmail,
      ...(replyTo ? { reply_to: replyTo } : {}),
      to: [testTo],
      subject: testSubject,
      html: htmlContent,
      text: plainText,
    });

    if (result.error) {
      const msg =
        typeof result.error === "object" && "message" in result.error
          ? String(result.error.message)
          : "Resend error";
      return NextResponse.json({ error: `Resend Error: ${msg}` }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      message: `Test email sent to ${testTo}`,
      resendId: result.data?.id || null,
    });
  } catch (err) {
    console.error("[Test Email Error]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send test email." },
      { status: 502 },
    );
  }
}
