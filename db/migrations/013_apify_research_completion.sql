-- Promote successfully enriched businesses only when outreach and creative inputs are both ready.
UPDATE leads
SET workflow_status = 'research_completed', updated_at = now()
WHERE workflow_status = 'research_pending'
  AND enrichment_status = 'completed'
  AND NULLIF(BTRIM(email), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lead_images
    WHERE lead_images.lead_id = leads.id
      AND NULLIF(BTRIM(lead_images.url), '') IS NOT NULL
  );
