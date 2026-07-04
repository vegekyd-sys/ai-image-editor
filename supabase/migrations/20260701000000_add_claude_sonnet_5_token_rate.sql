-- Claude Sonnet 5 default model for Makaron Agent and Bedrock tips.
-- AWS promotional launch pricing is $2/$10 per 1M input/output tokens through 2026-08-31.
-- Admin can override this row from the Billing tab after pricing changes.
INSERT INTO token_rates (
  model_id,
  display_name,
  input_per_1m,
  output_per_1m,
  cache_read_per_1m,
  cache_write_per_1m,
  markup,
  is_active
) VALUES (
  'anthropic.claude-sonnet-5',
  'Claude Sonnet 5',
  2.00,
  10.00,
  0.20,
  2.50,
  2.0,
  true
)
ON CONFLICT (model_id) DO NOTHING;
