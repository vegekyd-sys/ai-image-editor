-- fal charges by output megapixels. The adapter supplies provider cost from
-- billable units, and this row controls the customer credit markup.
BEGIN;

INSERT INTO public.token_rates (
  model_id, display_name, input_per_1m, output_per_1m,
  cache_read_per_1m, cache_write_per_1m, markup, is_active
) VALUES ('z-image-turbo', 'Z-Image Turbo', 0, 0, 0, 0, 2, true)
ON CONFLICT (model_id) DO NOTHING;

COMMIT;
