-- OpenRouter standard context pricing in USD per million tokens.
-- https://openrouter.ai/api/v1/models/x-ai/grok-4.7/endpoints
-- Provider-reported cost handles the routed endpoint and long-context premiums.
INSERT INTO public.token_rates (
  model_id, display_name, input_per_1m, output_per_1m,
  cache_read_per_1m, cache_write_per_1m, markup, is_active
) VALUES
('x-ai/grok-4.7', 'Grok 4.7', 2.00, 6.00, 0.50, 0.00, 2.0, true)
ON CONFLICT (model_id) DO NOTHING;
