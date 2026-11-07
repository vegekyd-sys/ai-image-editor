-- Gemini Omni 1.2 Flash replaces 1.1 behind the same `google-omni` model id.
-- Google bills 1.2 video output at $12.00 / 1M tokens (1.1: $17.50), with the
-- same tokens per second, i.e. about 30% cheaper. Input stays $1.50 / 1M.
-- Rate card checked 2026-11-07: https://aistudio.google.com/docs/pricing#gemini-omni-1.2-flash
--   360p 1,931 tok/s -> $0.023172/s     720p 5,792 tok/s -> $0.069504/s
--   1080p 8,688 tok/s -> $0.104256/s    4k 17,376 tok/s -> $0.208512/s
-- Only rows still on the 1.1 seed value change; operator edits are preserved.
-- Apply together with the release that switches the adapter to 1.2.
UPDATE public.media_pricing AS p
SET output_usd_per_second = v.new_rate, updated_at = now()
FROM (VALUES
  ('360p', 0.0337925, 0.023172),
  ('720p', 0.10136, 0.069504),
  ('1080p', 0.15204, 0.104256),
  ('4k', 0.30408, 0.208512)
) AS v(resolution, old_rate, new_rate)
WHERE p.kind = 'video'
  AND p.model_id = 'google-omni'
  AND p.resolution = v.resolution
  AND p.operation IN ('generate', 'edit', 'extend')
  AND p.output_usd_per_second = v.old_rate;
