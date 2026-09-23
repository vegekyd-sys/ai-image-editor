-- Azure Global Standard short-context rates published for GPT-6 Sol and Luna.
-- The OpenRouter rows preserve exact provider attribution for Azure failover.
INSERT INTO token_rates (
  model_id,
  display_name,
  input_per_1m,
  output_per_1m,
  cache_read_per_1m,
  cache_write_per_1m,
  markup,
  is_active
) VALUES
  ('gpt-6-luna', 'GPT-6 Luna', 0.10, 0.50, 0.01, 0.125, 2.0, true),
  ('gpt-6-sol', 'GPT-6 Sol', 2.00, 10.00, 0.20, 2.50, 2.0, true),
  ('openai/gpt-6-luna', 'GPT-6 Luna (OpenRouter)', 0.10, 0.50, 0.01, 0.125, 2.0, true),
  ('openai/gpt-6-sol', 'GPT-6 Sol (OpenRouter)', 2.00, 10.00, 0.20, 2.50, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  input_per_1m = EXCLUDED.input_per_1m,
  output_per_1m = EXCLUDED.output_per_1m,
  cache_read_per_1m = EXCLUDED.cache_read_per_1m,
  cache_write_per_1m = EXCLUDED.cache_write_per_1m,
  markup = EXCLUDED.markup,
  is_active = true;
