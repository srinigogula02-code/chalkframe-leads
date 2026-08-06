ALTER TABLE leads ADD COLUMN IF NOT EXISTS collage_original_image_id uuid;

ALTER TABLE leads ADD CONSTRAINT leads_collage_original_image_id_fkey
  FOREIGN KEY (collage_original_image_id) REFERENCES lead_images(id) ON DELETE SET NULL;

ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_url text;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_status text NOT NULL DEFAULT 'waiting';
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_error text;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_source_image_id uuid;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_source_redesign_url text;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_requested_at timestamptz;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_started_at timestamptz;
ALTER TABLE redesign_images ADD COLUMN IF NOT EXISTS collage_completed_at timestamptz;

ALTER TABLE redesign_images ADD CONSTRAINT redesign_images_collage_status_check
  CHECK (collage_status IN ('waiting', 'queued', 'processing', 'completed', 'failed'));

ALTER TABLE redesign_images ADD CONSTRAINT redesign_images_collage_source_image_id_fkey
  FOREIGN KEY (collage_source_image_id) REFERENCES lead_images(id) ON DELETE SET NULL;

WITH single_original AS (
  SELECT lead_id, min(id::text)::uuid AS image_id
  FROM lead_images
  GROUP BY lead_id
  HAVING count(*) = 1
)
UPDATE leads l
SET collage_original_image_id = original.image_id
FROM single_original original
WHERE l.id = original.lead_id
  AND l.collage_original_image_id IS NULL;

UPDATE redesign_images r
SET collage_status = CASE WHEN l.collage_original_image_id IS NULL THEN 'waiting' ELSE 'queued' END,
    collage_requested_at = CASE WHEN l.collage_original_image_id IS NULL THEN NULL ELSE now() END
FROM leads l
WHERE r.lead_id = l.id
  AND r.collage_url IS NULL;

CREATE INDEX IF NOT EXISTS redesign_images_collage_queue_idx
  ON redesign_images(collage_status, collage_requested_at)
  WHERE collage_status IN ('queued', 'processing');
