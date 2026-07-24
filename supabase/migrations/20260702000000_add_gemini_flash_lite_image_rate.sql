-- Token rates for OpenRouter Lite tips and tips preview.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup, is_active)
VALUES
  ('google/gemini-3.1-flash-lite', 'OR Gemini 3.1 Flash Lite', 0.25, 1.50, 2.0, true),
  -- Image output uses image-token pricing, not Flash-Lite text output pricing.
  ('google/gemini-3.1-flash-lite-image', 'OR Nano Banana 2 Lite', 0.25, 30.00, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  input_per_1m = EXCLUDED.input_per_1m,
  output_per_1m = EXCLUDED.output_per_1m,
  markup = EXCLUDED.markup,
  is_active = EXCLUDED.is_active,
  updated_at = now();
