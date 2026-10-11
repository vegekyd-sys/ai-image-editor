-- GPT-6.1 Sol standard rates: https://developers.openai.com/api/docs/models/gpt-6.1-sol
-- Upstream can report cold input separately as cache-write tokens.
-- Charge that slice at the ordinary input rate, with no write premium.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m,
 cache_read_per_1m, cache_write_per_1m, markup, is_active) VALUES
 ('gpt-6.1-sol', 'GPT-6.1 Sol', 2.00, 10.00, 0.10, 2.00, 2.0, true),
 ('openai/gpt-6.1-sol', 'GPT-6.1 Sol (OpenRouter)', 2.00, 10.00, 0.10, 2.00, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET display_name=EXCLUDED.display_name,
 input_per_1m=EXCLUDED.input_per_1m, output_per_1m=EXCLUDED.output_per_1m,
 cache_read_per_1m=EXCLUDED.cache_read_per_1m, cache_write_per_1m=EXCLUDED.cache_write_per_1m,
 markup=EXCLUDED.markup, is_active=EXCLUDED.is_active;
