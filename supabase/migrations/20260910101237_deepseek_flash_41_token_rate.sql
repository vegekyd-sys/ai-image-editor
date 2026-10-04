-- Official peak USD rates (2026-09-10); retail catalog uses peak rates consistently.
-- Off-peak upstream cost is half; this is not an actual-provider-cost estimate.
INSERT INTO public.token_rates
  (model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active)
VALUES ('deepseek/deepseek-flash', 'DeepSeek V4.1 Flash', 0.30, 1.20, 0.006, 0, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
