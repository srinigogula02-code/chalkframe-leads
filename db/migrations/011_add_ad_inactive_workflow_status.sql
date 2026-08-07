-- Migration 011: Add ad_inactive to leads_workflow_status_check constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_workflow_status_check;

ALTER TABLE leads ADD CONSTRAINT leads_workflow_status_check
  CHECK (workflow_status = ANY (ARRAY['research_pending'::text, 'ad_inactive'::text, 'research_completed'::text, 'redesign_created'::text, 'contacted'::text]));
