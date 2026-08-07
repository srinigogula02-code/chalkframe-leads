ALTER TABLE ai_ad_redesign_settings
  ADD COLUMN IF NOT EXISTS aspect_ratio text NOT NULL DEFAULT '1:1',
  ADD COLUMN IF NOT EXISTS quality text NOT NULL DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS creative_guidance text;

UPDATE ai_ad_redesign_settings
SET model = 'openai/gpt-image-2',
    fallback_model = 'openai/gpt-image-1'
WHERE id = 1 AND model IN ('google/gemini-2.5-flash', 'openai/gpt-5.4-image-2');
