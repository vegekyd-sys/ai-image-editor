-- Upgrade Makaron's selectable Grok Agent route from 4.5 to 4.6.
-- OpenRouter and xAI publish the same short-context input/output rates for 4.6;
-- cached input is $0.50/M. Provider-reported exact cost remains authoritative.
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
  'x-ai/grok-4.6',
  'Grok 4.6',
  2.00,
  6.00,
  0.50,
  0.00,
  2.0,
  true
)
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
WHERE model_id = 'x-ai/grok-4.5';
