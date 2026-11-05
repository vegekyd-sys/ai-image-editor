-- Candidate only: review and apply to the intended database during an authorized release.
-- GPT Image 2.6 uses fal's actual USD billable units, not a fixed per-image charge.
-- Native 2.5/2.6 token list rates match; retain each predecessor's business markup.
-- This does not update any existing model, default, account, or provider setting.
BEGIN;

INSERT INTO public.token_rates (
  model_id, display_name, input_per_1m, output_per_1m,
  cache_read_per_1m, cache_write_per_1m, markup, is_active
)
SELECT target.model_id, target.display_name, source.input_per_1m, source.output_per_1m,
  source.cache_read_per_1m, source.cache_write_per_1m, source.markup, true
FROM (VALUES
  ('gpt-image-2.6-flare', 'GPT Image 2.6 Flare', 'gpt-image-2.5-flare'),
  ('gpt-image-2.6-sunburst', 'GPT Image 2.6 Sunburst', 'gpt-image-2.5-sunburst')
) AS target(model_id, display_name, predecessor_id)
JOIN public.token_rates AS source ON source.model_id = target.predecessor_id
WHERE source.is_active AND source.markup > 0
ON CONFLICT (model_id) DO NOTHING;

-- Do not silently finish with missing pricing or reactivate an explicitly disabled row.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.token_rates
      WHERE model_id IN ('gpt-image-2.6-flare', 'gpt-image-2.6-sunburst')
        AND is_active AND markup > 0) <> 2 THEN
    RAISE EXCEPTION 'GPT Image 2.6 requires two explicit active pricing rows; check predecessor rows or existing disabled candidates';
  END IF;
END
$$;

COMMIT;
