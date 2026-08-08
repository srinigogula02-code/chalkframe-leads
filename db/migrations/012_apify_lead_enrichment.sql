CREATE TABLE IF NOT EXISTS apify_enrichment_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_token_ciphertext text,
  api_token_hint text,
  token_version uuid NOT NULL DEFAULT gen_random_uuid(),
  auto_enrich_on_add boolean NOT NULL DEFAULT false,
  monthly_budget_usd numeric(10,2) NOT NULL DEFAULT 5.00 CHECK (monthly_budget_usd > 0 AND monthly_budget_usd <= 1000),
  max_ads_per_business integer NOT NULL DEFAULT 30 CHECK (max_ads_per_business BETWEEN 1 AND 100),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO apify_enrichment_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS facebook_page_data jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'not_started';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_enrichment_status_check
    CHECK (enrichment_status IN ('not_started', 'queued', 'processing', 'completed', 'failed', 'blocked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE lead_images ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE lead_images ADD COLUMN IF NOT EXISTS source_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS lead_images_source_url_unique
  ON lead_images (lead_id, source_url) WHERE source_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lead_images_source_fingerprint_unique
  ON lead_images (lead_id, source_fingerprint) WHERE source_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  token_version uuid NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  apify_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ads_found integer NOT NULL DEFAULT 0,
  creatives_found integer NOT NULL DEFAULT 0,
  creatives_saved integer NOT NULL DEFAULT 0,
  fields_updated jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_usd numeric(14,8),
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT lead_enrichment_runs_trigger_check CHECK (trigger IN ('automatic', 'manual', 'bulk')),
  CONSTRAINT lead_enrichment_runs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_enrichment_runs_active_unique
  ON lead_enrichment_runs (lead_id) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS lead_enrichment_runs_created_idx ON lead_enrichment_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS lead_enrichment_runs_token_month_idx ON lead_enrichment_runs (token_version, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_enrichment_status_idx ON leads (enrichment_status, created_at DESC);
