CREATE TABLE IF NOT EXISTS email_templates (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand_name text NOT NULL DEFAULT 'Chalkframe Performance Marketing',
  logo_url text DEFAULT 'https://cdn.chalkframe.work/brand/chalkframe-logo.png',
  header_badge text NOT NULL DEFAULT 'Meta Ad Growth Analysis',
  cta_button_text text NOT NULL DEFAULT 'View Interactive Ad Breakdown',
  cta_button_url_override text,
  footer_text text NOT NULL DEFAULT 'Chalkframe Performance Marketing. Scaling Meta ads with AI performance creatives.',
  accent_color text NOT NULL DEFAULT '#f59e0b',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO email_templates (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  redesign_image_id uuid REFERENCES redesign_images(id) ON DELETE SET NULL,
  resend_id text,
  recipient_email text NOT NULL,
  sender_email text NOT NULL,
  subject text NOT NULL,
  body_markdown text NOT NULL,
  html_content text NOT NULL,
  collage_url text,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sent_emails_lead_idx ON sent_emails(lead_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS sent_emails_sent_at_idx ON sent_emails(sent_at DESC);
