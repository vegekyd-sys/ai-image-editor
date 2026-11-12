-- Candidate release prerequisite. Apply only to the database selected for release.
-- EvoLink is charged by output tier plus every input image, not by tokens.
-- The adapter supplies exact USD cost; this row controls the standard 2x markup.
-- Keep an administrator's existing price/disabled decision on repeated application.
BEGIN;

INSERT INTO public.token_rates (
  model_id, display_name, input_per_1m, output_per_1m,
  cache_read_per_1m, cache_write_per_1m, markup, is_active
) VALUES ('seedream-5.5', 'Seedream 5.5', 0, 0, 0, 0, 2, true)
ON CONFLICT (model_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.token_rates
    WHERE model_id = 'seedream-5.5' AND is_active AND markup > 0
      AND markup <> 'NaN'::numeric AND markup <> 'Infinity'::numeric
      AND input_per_1m = 0 AND output_per_1m = 0
  ) THEN
    RAISE EXCEPTION 'Seedream 5.5 requires an explicit active provider-cost pricing row with positive finite markup';
  END IF;
END
$$;

COMMIT;
