import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { Resend } from "resend";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    body?: string;
  };

  const to = body.to?.trim();
  const subject = body.subject?.trim();
  const text = body.body?.trim();

  if (!to) return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject line is required." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Email body is required." }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured. Add it to your environment variables." }, { status: 503 });
  }

  const senderEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Chalkframe <updates@chalkframe.work>";

  try {
    const resendClient = new Resend(apiKey);
    const result = await resendClient.emails.send({
      from: senderEmail,
      to: [to],
      subject,
      text,
    });

    if (result.error) {
      const errorMsg = typeof result.error === "object" && "message" in result.error ? String(result.error.message) : "Resend delivery error";
      return NextResponse.json({ error: `Resend Error: ${errorMsg}` }, { status: 502 });
    }

    const resendId = result.data?.id || null;

    // Log plain send in sent_emails with minimal html_content
    await sql`INSERT INTO sent_emails (resend_id, recipient_email, sender_email, subject, body_markdown, html_content, status)
      VALUES (${resendId}, ${to}, ${senderEmail}, ${subject}, ${text}, ${text}, 'sent')`;

    return NextResponse.json({ ok: true, message: `Plain email sent to ${to}!`, resendId });
  } catch (error) {
    console.error("[Plain Email Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plain email send failed." },
      { status: 502 },
    );
  }
}
