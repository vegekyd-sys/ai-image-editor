-- OpenRouter GPT-5.6 Agent routes. The existing unprefixed rows remain the
-- Azure rates so switching providers never overwrites the standby backend.
-- OpenRouter provider-reported exact cost is authoritative for routed/tiered
-- pricing; these rows preserve attribution, markup, and a base-rate fallback.
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
  ('openai/gpt-5.4-image-2', 'GPT Image 2 (OpenRouter)', 8.00, 30.00, 2.00, 8.00, 2.0, true),
  ('openai/gpt-5.6-terra', 'GPT-5.6 Terra (OpenRouter)', 1.00, 6.00, 0.10, 1.25, 2.0, true),
  ('openai/gpt-5.6-sol', 'GPT-5.6 Sol (OpenRouter)', 5.00, 30.00, 0.50, 6.25, 2.0, true),
  ('openai/gpt-5.6-luna', 'GPT-5.6 Luna (OpenRouter)', 0.10, 0.60, 0.01, 0.125, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  input_per_1m = EXCLUDED.input_per_1m,
  output_per_1m = EXCLUDED.output_per_1m,
  cache_read_per_1m = EXCLUDED.cache_read_per_1m,
  cache_write_per_1m = EXCLUDED.cache_write_per_1m,
  markup = EXCLUDED.markup,
  is_active = true;
