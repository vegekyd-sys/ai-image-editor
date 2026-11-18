-- Fill the missing Native reference-video tariff for 480p and 720p.
-- EvoLink rate card verified 2026-11-18: https://evolink.ai/seedance-2-5
-- Use the existing input-plus-output pricing path and preserve configured values.
UPDATE public.media_pricing AS price
SET video_reference_usd_per_second = tariff.reference_rate,
    updated_at = now()
FROM (VALUES ('480p', 0.084), ('720p', 0.180)) AS tariff(resolution, reference_rate)
WHERE price.id = 'video:seedance-2.5:' || tariff.resolution || ':' || price.operation
  AND price.kind = 'video'
  AND price.model_id = 'seedance-2.5'
  AND price.resolution = tariff.resolution
  AND price.operation IN ('generate', 'edit', 'extend')
  AND price.is_active
  AND price.video_reference_usd_per_second IS NULL;
