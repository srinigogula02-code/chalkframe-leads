ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS auto_send_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE lead_email_drafts
  ADD COLUMN IF NOT EXISTS auto_send_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS auto_send_error text,
  ADD COLUMN IF NOT EXISTS auto_send_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_sent_at timestamptz;

ALTER TABLE lead_email_drafts
  DROP CONSTRAINT IF EXISTS lead_email_drafts_auto_send_status_check;

ALTER TABLE lead_email_drafts
  ADD CONSTRAINT lead_email_drafts_auto_send_status_check
  CHECK (auto_send_status IN ('not_requested', 'sending', 'sent', 'failed'));

UPDATE lead_email_drafts d
SET auto_send_status = 'sent',
    auto_sent_at = sent.latest_sent_at,
    updated_at = GREATEST(d.updated_at, sent.latest_sent_at)
FROM (
  SELECT lead_id, redesign_image_id, MAX(sent_at) AS latest_sent_at
  FROM sent_emails
  WHERE status = 'sent' AND redesign_image_id IS NOT NULL
  GROUP BY lead_id, redesign_image_id
) sent
WHERE d.lead_id = sent.lead_id AND d.redesign_image_id = sent.redesign_image_id;

CREATE INDEX IF NOT EXISTS lead_email_drafts_auto_send_idx
  ON lead_email_drafts(auto_send_status, completed_at)
  WHERE auto_send_status IN ('sending', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS sent_emails_one_success_per_redesign_idx
  ON sent_emails(lead_id, redesign_image_id)
  WHERE status = 'sent' AND redesign_image_id IS NOT NULL;
