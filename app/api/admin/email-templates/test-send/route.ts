import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getEmailTemplateSettings,
  renderAdRedesignEmailHtml,
  renderPlainText,
} from "@/lib/resend-email";
import { Resend } from "resend";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
  };

  const to = body.to?.trim();
  if (!to) return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured. Add it to your environment variables." },
      { status: 503 },
    );
  }

  const senderEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "Chalkframe <updates@chalkframe.work>";
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || undefined;

  const template = await getEmailTemplateSettings();
  const subject = body.subject?.trim() || "Chalkframe · Your Ad Creative Redesign [TEST]";

  const testBodyText = `Hi there,

We analyzed your recent Meta ad creative and crafted a high-converting redesign for Instagram and Facebook placements.

Here are the key improvements made:
- Mobile-first typography with stronger visual hierarchy
- Contrast-optimised color palette for thumb-stopping scroll performance
- Restructured CTA placement above the fold

The collage above shows the side-by-side comparison of your original creative vs. the AI-optimised redesign. Let us know if you have any questions.

Thanks,
Chalkframe Performance Marketing`;

  const htmlContent = renderAdRedesignEmailHtml({
    subject,
    bodyText: testBodyText,
    recipientEmail: to,
    collageUrl: null,
    template,
  });

  const plainText = renderPlainText({
    bodyText: testBodyText,
    subject,
    ctaUrl: template.cta_button_url_override || "https://chalkframe.com",
    ctaText: template.cta_button_text,
    footerText: template.footer_text,
    recipientEmail: to,
  });

  try {
    const resendClient = new Resend(apiKey);
    const result = await resendClient.emails.send({
      from: senderEmail,
      ...(replyTo ? { reply_to: replyTo } : {}),
      to: [to],
      subject,
      html: htmlContent,
      text: plainText,
    });

    if (result.error) {
      const errorMsg =
        typeof result.error === "object" && "message" in result.error
          ? String(result.error.message)
          : "Resend delivery error";
      return NextResponse.json({ error: `Resend Error: ${errorMsg}` }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      message: `Test email sent to ${to}`,
      resendId: result.data?.id || null,
    });
  } catch (error) {
    console.error("[Test Email Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test email." },
      { status: 502 },
    );
  }
}
