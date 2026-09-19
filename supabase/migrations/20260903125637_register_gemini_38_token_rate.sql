-- Merge compatibility: Gemini 3.8 was added to dev after the media catalog branch.
-- Materialize its existing introductory rate instead of keeping a hidden fallback.
-- Existing Admin overrides must never be overwritten.
-- Introductory pricing ends 2027-01-01 UTC; revalidate/update the DB rate before then.
INSERT INTO public.token_rates
  (model_id, display_name, input_per_1m, output_per_1m,
   cache_read_per_1m, cache_write_per_1m, markup, is_active)
VALUES
  ('gemini-3.8-flash', 'Gemini 3.8 Flash', 0.75, 3.75, 0.075, 0.75, 2, true)
ON CONFLICT (model_id) DO NOTHING;
