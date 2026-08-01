ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS draft_by uuid REFERENCES users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_website_status_check CHECK (website_status IN ('unknown', 'yes', 'no'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE leads SET website_status = 'yes' WHERE has_website = true OR website_url IS NOT NULL;

-- Repair records that were completed without any research result.
UPDATE leads l SET status = 'pending', completed_by = NULL, completed_at = NULL, updated_at = now()
WHERE status = 'completed'
  AND facebook_url IS NULL AND instagram_url IS NULL AND email IS NULL
  AND phone IS NULL AND website_url IS NULL AND notes IS NULL
  AND NOT EXISTS (SELECT 1 FROM lead_images i WHERE i.lead_id = l.id);

CREATE UNIQUE INDEX IF NOT EXISTS leads_ad_url_unique ON leads(ad_url);
CREATE INDEX IF NOT EXISTS leads_draft_by_idx ON leads(draft_by) WHERE draft_by IS NOT NULL;
