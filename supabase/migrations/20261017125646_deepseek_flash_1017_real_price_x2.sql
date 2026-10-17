-- Official peak USD per 1M tokens, verified 2026-10-17.
-- https://api-docs.deepseek.com/quick_start/pricing/
-- Runtime applies off-peak 0.5 per inference step, then applies this markup once.
INSERT INTO public.token_rates
  (model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active)
VALUES ('deepseek/deepseek-flash', 'DeepSeek V4.1 Flash 1017', 0.30, 1.20, 0.006, 0, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  input_per_1m = EXCLUDED.input_per_1m,
  output_per_1m = EXCLUDED.output_per_1m,
  cache_read_per_1m = EXCLUDED.cache_read_per_1m,
  cache_write_per_1m = EXCLUDED.cache_write_per_1m,
  markup = EXCLUDED.markup,
  is_active = EXCLUDED.is_active;
