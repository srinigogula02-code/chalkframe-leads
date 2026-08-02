CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS leads_queue_order_idx
  ON leads ((status = 'pending') DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS leads_status_created_idx
  ON leads (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS leads_workflow_created_idx
  ON leads (workflow_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS leads_search_trgm_idx
  ON leads USING gin ((COALESCE(title, '') || ' ' || ad_url || ' ' || COALESCE(email, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lead_images_lead_position_idx
  ON lead_images (lead_id, position);
