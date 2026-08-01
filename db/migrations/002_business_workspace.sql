ALTER TABLE leads ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'research_pending';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS admin_notes text;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_workflow_status_check
    CHECK (workflow_status IN ('research_pending', 'research_completed', 'redesign_created', 'contacted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE leads SET workflow_status = 'research_completed'
WHERE status = 'completed' AND workflow_status = 'research_pending';

CREATE TABLE IF NOT EXISTS redesign_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_workflow_status_idx ON leads(workflow_status, created_at DESC);
CREATE INDEX IF NOT EXISTS redesign_images_lead_idx ON redesign_images(lead_id, position);
