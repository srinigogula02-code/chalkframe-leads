import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { sendLeadRedesignEmail } from "@/lib/resend-email";

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  if(body.redesignImageId){
    if(!uuidPattern.test(body.redesignImageId))return NextResponse.json({error:"The redesign identifier is invalid."},{status:400});
    const existing=await sql`SELECT r.id,(SELECT MAX(s.sent_at) FROM sent_emails s WHERE s.lead_id=${leadId} AND s.redesign_image_id=r.id AND s.status='sent') AS sent_at
      FROM redesign_images r WHERE r.id=${body.redesignImageId} AND r.lead_id=${leadId} LIMIT 1`;
    if(!existing[0])return NextResponse.json({error:"The redesign does not belong to this business."},{status:400});
    if(existing[0].sent_at)return NextResponse.json({error:"This redesign email has already been sent successfully."},{status:409});
    const claimed=await sql`UPDATE lead_email_drafts SET auto_send_status='sending',auto_send_error=NULL,auto_send_attempted_at=now(),updated_at=now()
      WHERE lead_id=${leadId} AND redesign_image_id=${body.redesignImageId} AND status='completed' AND auto_send_status IN ('not_requested','failed') RETURNING id`;
    if(!claimed[0])return NextResponse.json({error:"This email is already being sent or has already been delivered."},{status:409});
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
      workflowStatus: "contacted",
    });
  } catch (error) {
    console.error("[Resend API Error]", error);
    if(body.redesignImageId)await sql`UPDATE lead_email_drafts SET auto_send_status='failed',auto_send_error=${error instanceof Error?error.message.slice(0,1000):"Email delivery via Resend failed."},updated_at=now() WHERE lead_id=${leadId} AND redesign_image_id=${body.redesignImageId} AND auto_send_status='sending'`;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email delivery via Resend failed." },
      { status: 502 },
    );
  }
}
