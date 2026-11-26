-- EvoLink MAGI-2: https://evolink.ai/magi-2#pricing
-- 1080p at $0.08 per output second, inclusive of reference inputs.
INSERT INTO public.media_pricing
  (id, kind, model_id, resolution, operation, output_usd_per_second)
VALUES
  ('video:magi-2:1080p:generate', 'video', 'magi-2', '1080p', 'generate', 0.08)
ON CONFLICT (id) DO NOTHING;
