-- Cache-aware rates for the user-selectable Makaron Agent models.
-- Prices are provider USD per 1M tokens; Makaron applies the row markup.
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
  ('anthropic.claude-sonnet-4-6', 'Claude Sonnet 4.6', 3.00, 15.00, 0.30, 3.75, 2.0, true),
  ('anthropic.claude-sonnet-5', 'Claude Sonnet 5', 2.00, 10.00, 0.20, 2.50, 2.0, true),
  ('anthropic.claude-opus-4-8', 'Claude Opus 4.8', 5.00, 25.00, 0.50, 6.25, 2.0, true),
  ('x-ai/grok-4.5', 'Grok 4.5', 2.00, 6.00, 0.50, 0.00, 2.0, true),
  ('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 0.435, 0.87, 0.003625, 0.00, 2.0, true),
  ('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 0.50, 3.00, 0.05, 0.50, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
