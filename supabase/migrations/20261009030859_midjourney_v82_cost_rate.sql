-- Batch cost + prompt-preparation cost are reported by providers; never multiply by candidate count.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup, is_active)
VALUES ('mj-v8.2', 'Midjourney V8.2', 0, 0, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
