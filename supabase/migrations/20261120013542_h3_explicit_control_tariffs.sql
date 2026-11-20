-- Candidate-only SKUs. Existing model/operation rows and operator prices stay intact.
-- Rates are list USD, separate from account discounts. Recast requires per-shot metering.
WITH variants(model, feature, operation, p480, p768, p1080) AS (
  VALUES
    ('minimax-h3-max', 'turbo-generation', 'generate', NULL::numeric, NULL::numeric, 0.08),
    ('minimax-h3-max', 'turbo-extend', 'extend', 0.025, 0.04, 0.08),
    ('fal-h3-max', 'camera', 'generate', 0.05, 0.08, 0.16),
    ('fal-h3-max', 'relight', 'edit', 0.05, 0.08, 0.16),
    ('fal-h3-max', 'reframe', 'edit', 0.05, 0.08, 0.16),
    ('fal-h3-max', 'photo-lipsync', 'generate', 0.05, 0.08, 0.16)
)
INSERT INTO public.media_pricing (id,kind,model_id,resolution,operation,output_usd_per_second)
SELECT 'video:' || model || ':' || feature || ':' || band.resolution,
       'video', model || ':' || feature, band.resolution, operation, band.rate
FROM variants
CROSS JOIN LATERAL (VALUES ('480p',p480), ('768p',p768), ('1080p',p1080)) AS band(resolution,rate)
WHERE band.rate IS NOT NULL
ON CONFLICT (id) DO NOTHING;
