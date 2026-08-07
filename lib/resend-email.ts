import { Resend } from "resend";
import { sql } from "./db";

export type EmailTemplateSettings = {
  id: number;
  show_cta: boolean;
  cta_button_text: string;
  cta_button_url_override: string | null;
  footer_text: string;
  accent_color: string;
  updated_at: string;
};

const esc = (s: string) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c,
  );

export async function getEmailTemplateSettings(): Promise<EmailTemplateSettings> {
  const rows = await sql`SELECT id, show_cta, cta_button_text, cta_button_url_override, footer_text, accent_color, updated_at FROM email_templates WHERE id=1`;
  if (rows[0]) return rows[0] as unknown as EmailTemplateSettings;
  return {
    id: 1,
    show_cta: true,
    cta_button_text: "View Interactive Ad Breakdown",
    cta_button_url_override: null,
    footer_text: "",
    accent_color: "#f59e0b",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Converts the email body text into a clean plain-text version.
 * Critical for deliverability — emails without a plain-text part score lower.
 */
export function renderPlainText({
  bodyText,
  subject,
  ctaUrl,
  ctaText,
  footerText,
  recipientEmail,
}: {
  bodyText: string;
  subject: string;
  ctaUrl?: string | null;
  ctaText?: string;
  footerText?: string;
  recipientEmail?: string | null;
}): string {
  const lines = bodyText.trim().split(/\r?\n/);
  const formattedBody = lines
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // convert bullet markers to plain dashes
      return trimmed.replace(/^\s*(?:[•*]|\d+[.)]) /, "- ");
    })
    .join("\n");

  const sections: string[] = [subject ? `${subject}\n${"=".repeat(subject.length)}` : "", formattedBody];

  if (ctaUrl) {
    sections.push(`\n${ctaText || "View Interactive Ad Breakdown"}: ${ctaUrl}`);
  }

  const footer: string[] = [];
  if (footerText) footer.push(footerText);
  if (recipientEmail) footer.push(`This email was sent to ${recipientEmail}.`);
  footer.push(
    "You're receiving this because we came across your Meta ad and noticed an opportunity to significantly improve its creative performance.",
  );
  if (sections[sections.length - 1] !== "") sections.push("");
  sections.push(footer.join("\n"));

  return sections.filter(s => s !== undefined).join("\n\n");
}

export function renderAdRedesignEmailHtml({
  subject,
  bodyText,
  recipientEmail,
  collageUrl,
  leadAdUrl,
  template,
  unsubscribeUrl,
}: {
  subject: string;
  bodyText: string;
  recipientName?: string;
  recipientEmail?: string | null;
  collageUrl?: string | null;
  leadAdUrl?: string | null;
  template?: Partial<EmailTemplateSettings>;
  /** Unsubscribe link shown in footer — required by Gmail bulk sender guidelines */
  unsubscribeUrl?: string | null;
}) {
  const showCta = template?.show_cta !== false; // default true
  const accentColor = template?.accent_color || "#f59e0b";
  const ctaText = template?.cta_button_text || "View Interactive Ad Breakdown";
  const ctaUrl = template?.cta_button_url_override || leadAdUrl || "https://chalkframe.com";
  const footerText = template?.footer_text || "";

  // Format body text into clean paragraphs & styled bullet lists
  const lines = bodyText.trim().split(/\r?\n/);
  const formattedHtml = lines
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "<br/>";
      if (/^\s*(?:[-•*]|\d+[.)]) /.test(trimmed)) {
        const bulletText = trimmed.replace(/^\s*(?:[-•*]|\d+[.)]) /, "");
        return `<li style="margin-bottom: 8px; line-height: 1.6;">${esc(bulletText)}</li>`;
      }
      return `<p style="margin: 0 0 14px 0; line-height: 1.65;">${esc(trimmed)}</p>`;
    })
    .join("\n")
    .replace(
      /(<li[\s\S]*?<\/li>\n?)+/g,
      match => `<ul style="margin: 12px 0 18px 0; padding-left: 20px; color: #1f2937;">${match}</ul>`,
    );

  const unsubscribeHtml = unsubscribeUrl
    ? `<p style="margin: 8px 0 0 0; font-size: 11px; color: #9ca3af;">
        If you no longer wish to receive emails like this,
        <a href="${esc(unsubscribeUrl)}" style="color: #9ca3af; text-decoration: underline;">unsubscribe here</a>.
      </p>`
    : `<p style="margin: 8px 0 0 0; font-size: 11px; color: #9ca3af;">
        You’re receiving this because we came across your Meta ad and noticed an opportunity to significantly improve its creative performance.
      </p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; width: 100% !important;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">

          ${collageUrl ? `<!-- 16:9 Comparison Collage Banner -->
          <tr>
            <td style="padding: 0; background-color: #000000; text-align: center;">
              <img src="${esc(collageUrl)}" alt="Original vs AI Redesign Ad Creative Comparison" style="width: 100%; max-width: 100%; height: auto; display: block; border: 0; border-radius: 12px 12px 0 0;" />
            </td>
          </tr>` : ""}

          <!-- Body Content Area -->
          <tr>
            <td style="padding: 28px 24px 20px 24px; font-size: 15px; color: #374151;">
              ${formattedHtml}

              ${showCta && ctaUrl ? `<!-- Call to Action Button -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 24px; margin-bottom: 12px;">
                <tr>
                  <td align="center">
                    <a href="${esc(ctaUrl)}" target="_blank" style="display: inline-block; background-color: ${esc(accentColor)}; color: #0f172a; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 26px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.12);">
                      ${esc(ctaText)} →
                    </a>
                  </td>
                </tr>
              </table>` : ""}
            </td>
          </tr>

          <!-- Footer Area -->
          <tr>
            <td style="padding: 20px 24px; background-color: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center; font-size: 12px; color: #6b7280; line-height: 1.5;">
              ${footerText ? `<p style="margin: 0 0 6px 0;">${esc(footerText)}</p>` : ""}
              ${recipientEmail ? `<p style="margin: 0 0 4px 0; font-size: 11px; color: #9ca3af;">Sent to <span style="color: #4b5563;">${esc(recipientEmail)}</span></p>` : ""}
              ${unsubscribeHtml}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Builds the standard Resend send options with all deliverability best practices:
 * - Plain text version alongside HTML (reduces spam score significantly)
 * - List-Unsubscribe + List-Unsubscribe-Post headers (Gmail / RFC 8058 one-click)
 * - Reply-To set to a real monitored address
 */
function buildResendPayload({
  from,
  replyTo,
  to,
  subject,
  html,
  text,
  unsubscribeUrl,
}: {
  from: string;
  replyTo?: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string | null;
}) {
  type ResendHeaders = Record<string, string>;
  const headers: ResendHeaders = {};

  // RFC 2369 / RFC 8058 — one-click unsubscribe for Gmail bulk sender requirements
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    from,
    ...(replyTo ? { reply_to: replyTo } : {}),
    to,
    subject,
    html,
    text,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}

export async function sendLeadRedesignEmail({
  leadId,
  redesignImageId,
  recipientEmail,
  subject,
  bodyMarkdown,
  collageUrl,
}: {
  leadId: string;
  redesignImageId?: string;
  recipientEmail: string;
  subject: string;
  bodyMarkdown: string;
  collageUrl?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured in environment variables.");
  }

  const senderEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "Chalkframe <updates@chalkframe.work>";
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || undefined;
  const template = await getEmailTemplateSettings();

  const ctaUrl = template.cta_button_url_override || "https://chalkframe.com";
  const unsubscribeUrl = process.env.RESEND_UNSUBSCRIBE_URL?.trim() || null;

  const htmlContent = renderAdRedesignEmailHtml({
    subject,
    bodyText: bodyMarkdown,
    recipientEmail,
    collageUrl,
    template,
    unsubscribeUrl,
  });

  const plainText = renderPlainText({
    bodyText: bodyMarkdown,
    subject,
    ctaUrl,
    ctaText: template.cta_button_text,
    footerText: template.footer_text,
    recipientEmail,
  });

  const resendClient = new Resend(apiKey);
  const result = await resendClient.emails.send(
    buildResendPayload({
      from: senderEmail,
      replyTo,
      to: [recipientEmail.trim()],
      subject: subject.trim(),
      html: htmlContent,
      text: plainText,
      unsubscribeUrl,
    }),
  );

  if (result.error) {
    const errorMsg =
      typeof result.error === "object" && "message" in result.error
        ? String(result.error.message)
        : "Resend delivery error";
    await sql`INSERT INTO sent_emails (lead_id, redesign_image_id, resend_id, recipient_email, sender_email, subject, body_markdown, html_content, collage_url, status, error_message)
      VALUES (${leadId}, ${redesignImageId || null}, NULL, ${recipientEmail.trim()}, ${senderEmail}, ${subject.trim()}, ${bodyMarkdown}, ${htmlContent}, ${collageUrl || null}, 'failed', ${errorMsg})`;
    throw new Error(`Resend Error: ${errorMsg}`);
  }

  const resendId = result.data?.id || null;

  const row = await sql`INSERT INTO sent_emails (lead_id, redesign_image_id, resend_id, recipient_email, sender_email, subject, body_markdown, html_content, collage_url, status)
    VALUES (${leadId}, ${redesignImageId || null}, ${resendId}, ${recipientEmail.trim()}, ${senderEmail}, ${subject.trim()}, ${bodyMarkdown}, ${htmlContent}, ${collageUrl || null}, 'sent')
    RETURNING id, resend_id, sent_at`;

  // Update lead workflow status to contacted
  await sql`UPDATE leads SET workflow_status='contacted', updated_at=now() WHERE id=${leadId}`;

  return {
    sentEmailId: String(row[0].id),
    resendId: row[0].resend_id,
    sentAt: row[0].sent_at,
  };
}
