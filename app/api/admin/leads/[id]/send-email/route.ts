import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendLeadRedesignEmail } from "@/lib/resend-email";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leadId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    recipientEmail?: string;
    subject?: string;
    bodyMarkdown?: string;
    collageUrl?: string;
    redesignImageId?: string;
  };

  const recipientEmail = body.recipientEmail?.trim();
  const subject = body.subject?.trim();
  const bodyMarkdown = body.bodyMarkdown?.trim();

  if (!recipientEmail) {
    return NextResponse.json({ error: "Recipient email address is required." }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Email subject line is required." }, { status: 400 });
  }
  if (!bodyMarkdown) {
    return NextResponse.json({ error: "Email body text is required." }, { status: 400 });
  }

  try {
    const result = await sendLeadRedesignEmail({
      leadId,
      redesignImageId: body.redesignImageId,
      recipientEmail,
      subject,
      bodyMarkdown,
      collageUrl: body.collageUrl,
    });

    return NextResponse.json({
      ok: true,
      message: `Email successfully sent via Resend to ${recipientEmail}!`,
      resendId: result.resendId,
      sentAt: result.sentAt,
    });
  } catch (error) {
    console.error("[Resend API Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email delivery via Resend failed." },
      { status: 502 },
    );
  }
}
