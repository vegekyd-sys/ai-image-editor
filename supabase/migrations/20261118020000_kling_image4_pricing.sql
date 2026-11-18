-- Fal returns billable units per task. The adapter supplies the supplier USD cost.
-- Keep an administrator's existing price or disabled state on repeated application.
BEGIN;

INSERT INTO public.token_rates (
  model_id, display_name, input_per_1m, output_per_1m,
  cache_read_per_1m, cache_write_per_1m, markup, is_active
) VALUES ('kling-image-4.0', 'Kling Image 4.0', 0, 0, 0, 0, 2, true)
ON CONFLICT (model_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.token_rates
    WHERE model_id = 'kling-image-4.0' AND is_active AND markup > 0
      AND markup <> 'NaN'::numeric AND markup <> 'Infinity'::numeric
      AND input_per_1m = 0 AND output_per_1m = 0
  ) THEN
    RAISE EXCEPTION 'Kling Image 4.0 requires an active provider-cost rate with positive finite markup';
  END IF;
END
$$;

COMMIT;
