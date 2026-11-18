-- Standard USD / 1M tokens, including 30-minute cache writes.
-- https://developers.openai.com/api/docs/models/gpt-6.2-sol
-- https://developers.openai.com/api/docs/models/gpt-6.2-astra
-- https://developers.openai.com/api/docs/models/gpt-6.1-terra
-- Apply before enabling the new paid API choices. Subscription usage remains free of credits.
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m,
 cache_read_per_1m, cache_write_per_1m, markup, is_active) VALUES
 ('gpt-6.2-sol', 'GPT-6.2 Sol', 2.00, 10.00, 0.10, 2.50, 2.0, true),
 ('openai/gpt-6.2-sol', 'GPT-6.2 Sol (OpenRouter)', 2.00, 10.00, 0.10, 2.50, 2.0, true),
 ('gpt-6.2-astra', 'GPT-6.2 Astra', 8.00, 40.00, 0.40, 10.00, 2.0, true),
 ('openai/gpt-6.2-astra', 'GPT-6.2 Astra (OpenRouter)', 8.00, 40.00, 0.40, 10.00, 2.0, true),
 ('gpt-6.1-terra', 'GPT-6.1 Terra', 1.00, 5.00, 0.05, 1.25, 2.0, true),
 ('openai/gpt-6.1-terra', 'GPT-6.1 Terra (OpenRouter)', 1.00, 5.00, 0.05, 1.25, 2.0, true)
ON CONFLICT (model_id) DO UPDATE SET display_name=EXCLUDED.display_name,
 input_per_1m=EXCLUDED.input_per_1m, output_per_1m=EXCLUDED.output_per_1m,
 cache_read_per_1m=EXCLUDED.cache_read_per_1m, cache_write_per_1m=EXCLUDED.cache_write_per_1m,
 markup=EXCLUDED.markup, is_active=EXCLUDED.is_active;
