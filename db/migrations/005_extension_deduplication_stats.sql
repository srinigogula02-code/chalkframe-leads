ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_id text;

UPDATE leads
SET meta_ad_id = substring(ad_url from '[?&]id=([0-9]+)')
WHERE meta_ad_id IS NULL;

ALTER TABLE leads ALTER COLUMN meta_ad_id SET NOT NULL;

ALTER TABLE leads ADD CONSTRAINT leads_meta_ad_id_format_check
  CHECK (meta_ad_id ~ '^[0-9]{1,32}$');

CREATE UNIQUE INDEX IF NOT EXISTS leads_meta_ad_id_unique ON leads (meta_ad_id);

CREATE TABLE IF NOT EXISTS extension_capture_stats (
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  user_id uuid NOT NULL REFERENCES users(id),
  added_count bigint NOT NULL DEFAULT 0 CHECK (added_count >= 0),
  duplicate_count bigint NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, user_id)
);

CREATE INDEX IF NOT EXISTS extension_capture_stats_recent_idx
  ON extension_capture_stats (day DESC);
