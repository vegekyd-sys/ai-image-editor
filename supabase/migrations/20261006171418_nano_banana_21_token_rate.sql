-- OpenRouter Nano Banana 2.1: exact supplier cost is used for final billing.
-- Token rates are retained as catalog data; text/thinking differs from image output.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup, is_active)
VALUES ('google/gemini-nano-banana-2.1', 'Nano Banana 2.1', 1.50, 30.00, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
