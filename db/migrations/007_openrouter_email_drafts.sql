CREATE TABLE IF NOT EXISTS ai_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  fallback_model text,
  temperature numeric(3,2) NOT NULL DEFAULT 0.35 CHECK (temperature >= 0 AND temperature <= 2),
  max_output_tokens integer NOT NULL DEFAULT 700 CHECK (max_output_tokens BETWEEN 200 AND 2000),
  max_cost_usd numeric(10,6) NOT NULL DEFAULT 0.10 CHECK (max_cost_usd > 0 AND max_cost_usd <= 10),
  monthly_budget_usd numeric(12,2) NOT NULL DEFAULT 25 CHECK (monthly_budget_usd > 0 AND monthly_budget_usd <= 10000),
  system_prompt_override text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_settings (id, fallback_model)
VALUES (1, 'openai/gpt-4o-mini')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lead_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  redesign_image_id uuid NOT NULL UNIQUE REFERENCES redesign_images(id) ON DELETE CASCADE,
  source_collage_url text,
  recipient_email text,
  status text NOT NULL DEFAULT 'waiting',
  subject text,
  body text,
  raw_output text,
  review_reason text,
  error_code text,
  error_message text,
  requested_model text,
  actual_model text,
  generation_id text,
  prompt_version text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_usd numeric(14,8),
  latency_ms integer,
  attempt_count integer NOT NULL DEFAULT 0,
  requested_trigger text NOT NULL DEFAULT 'automatic',
  requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_email_drafts_status_check CHECK (status IN ('waiting', 'queued', 'processing', 'completed', 'needs_review', 'blocked', 'failed'))
);

CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES lead_email_drafts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  redesign_image_id uuid REFERENCES redesign_images(id) ON DELETE SET NULL,
  lead_title text,
  trigger text NOT NULL DEFAULT 'automatic',
  status text NOT NULL DEFAULT 'processing',
  requested_model text NOT NULL,
  actual_model text,
  generation_id text,
  prompt_version text NOT NULL,
  input_image_url text,
  recipient_email text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_usd numeric(14,8),
  latency_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_generation_runs_status_check CHECK (status IN ('processing', 'completed', 'needs_review', 'blocked', 'failed'))
);

INSERT INTO lead_email_drafts (
  lead_id, redesign_image_id, source_collage_url, recipient_email, status,
  requested_model, prompt_version, requested_trigger
)
SELECT l.id, r.id, r.collage_url, NULLIF(BTRIM(l.email), ''), 'waiting',
  settings.model, 'chalkframe-outreach-v1', 'automatic'
FROM redesign_images r
JOIN leads l ON l.id=r.lead_id
CROSS JOIN ai_settings settings
WHERE settings.id=1 AND r.collage_status='completed' AND r.collage_url IS NOT NULL
ON CONFLICT (redesign_image_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS lead_email_drafts_queue_idx
  ON lead_email_drafts(status, requested_at)
  WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS lead_email_drafts_lead_idx
  ON lead_email_drafts(lead_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_generation_runs_created_idx
  ON ai_generation_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS ai_generation_runs_model_idx
  ON ai_generation_runs(requested_model, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_generation_runs_status_idx
  ON ai_generation_runs(status, created_at DESC);
