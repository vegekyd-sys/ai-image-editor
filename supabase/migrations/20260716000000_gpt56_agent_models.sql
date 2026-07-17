-- GPT-5.6 Agent models. Prices are provider USD per 1M tokens.
-- Cache writes are 1.25x uncached input; Makaron applies the row markup.
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
  ('gpt-5.6-terra', 'GPT-5.6 Terra', 2.50, 15.00, 0.25, 3.125, 2.0, true),
  ('gpt-5.6-sol', 'GPT-5.6 Sol', 5.00, 30.00, 0.50, 6.25, 2.0, true),
  ('gpt-5.6-luna', 'GPT-5.6 Luna', 1.00, 6.00, 0.10, 1.25, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  input_per_1m = EXCLUDED.input_per_1m,
  output_per_1m = EXCLUDED.output_per_1m,
  cache_read_per_1m = EXCLUDED.cache_read_per_1m,
  cache_write_per_1m = EXCLUDED.cache_write_per_1m,
  markup = EXCLUDED.markup,
  is_active = true;

UPDATE token_rates
SET is_active = false
WHERE model_id IN (
  'anthropic.claude-sonnet-4-6',
  'anthropic.claude-sonnet-5',
  'anthropic.claude-opus-4-8',
  'us.anthropic.claude-opus-4-6-v1'
);
