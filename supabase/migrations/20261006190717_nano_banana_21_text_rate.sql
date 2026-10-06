-- Text-only Tips experiments use text rates, never the image output rate.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup, is_active)
VALUES ('google/gemini-nano-banana-2.1:text', 'Nano Banana 2.1 Text', 1.50, 7.50, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
