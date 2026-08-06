CREATE TABLE IF NOT EXISTS ai_ad_redesign_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  auto_redesign_on_ad_add boolean NOT NULL DEFAULT false,
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  fallback_model text DEFAULT 'openai/gpt-4o-mini',
  temperature numeric(3,2) NOT NULL DEFAULT 0.40 CHECK (temperature >= 0 AND temperature <= 2),
  max_output_tokens integer NOT NULL DEFAULT 1000 CHECK (max_output_tokens BETWEEN 200 AND 4000),
  max_cost_usd numeric(10,6) NOT NULL DEFAULT 0.20 CHECK (max_cost_usd > 0 AND max_cost_usd <= 10),
  monthly_budget_usd numeric(12,2) NOT NULL DEFAULT 50 CHECK (monthly_budget_usd > 0 AND monthly_budget_usd <= 10000),
  system_prompt_override text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_ad_redesign_settings (id, fallback_model)
VALUES (1, 'openai/gpt-4o-mini')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lead_ad_redesign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  source_image_id uuid REFERENCES lead_images(id) ON DELETE SET NULL,
  source_image_url text NOT NULL,
  redesign_image_id uuid REFERENCES redesign_images(id) ON DELETE SET NULL,
  redesign_image_url text,
  lead_title text,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'processing',
  requested_model text NOT NULL,
  actual_model text,
  generation_id text,
  prompt_used text NOT NULL,
  cost_usd numeric(14,8),
  latency_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT lead_ad_redesign_runs_status_check CHECK (status IN ('processing', 'completed', 'failed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS lead_ad_redesign_runs_created_idx
  ON lead_ad_redesign_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS lead_ad_redesign_runs_lead_idx
  ON lead_ad_redesign_runs(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_ad_redesign_runs_status_idx
  ON lead_ad_redesign_runs(status, created_at DESC);
