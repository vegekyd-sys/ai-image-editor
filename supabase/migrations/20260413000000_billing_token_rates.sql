-- Token rates table for per-token billing (Admin configurable)
CREATE TABLE IF NOT EXISTS token_rates (
  model_id text PRIMARY KEY,
  display_name text NOT NULL,
  input_per_1m numeric NOT NULL DEFAULT 0,
  output_per_1m numeric NOT NULL DEFAULT 0,
  markup numeric NOT NULL DEFAULT 2.0,
  is_active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Seed initial token rates (official prices as of 2026-04-14)
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup) VALUES
  -- Bedrock Claude (official Anthropic pricing)
  ('us.anthropic.claude-opus-4-6-v1', 'Claude Opus 4.6', 5.00, 25.00, 2.0),
  ('anthropic.claude-sonnet-4-6', 'Claude Sonnet 4.6', 3.00, 15.00, 2.0),
  -- Google direct
  ('gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash', 0.10, 0.40, 2.0),
  ('gemini-3-pro-image-preview', 'Gemini 3 Pro', 1.25, 5.00, 2.0),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 2.00, 12.00, 2.0),
  ('gemini-2.5-pro', 'Gemini 2.5 Pro', 1.25, 10.00, 2.0),
  ('gemini-2.5-flash', 'Gemini 2.5 Flash', 0.30, 2.50, 2.0),
  -- OpenRouter (Google Gemini) — OR has own markup vs Google direct
  ('google/gemini-3.1-flash-image-preview', 'OR Gemini 3.1 Flash', 0.50, 3.00, 2.0),
  ('google/gemini-3-pro-image-preview', 'OR Gemini 3 Pro', 2.00, 12.00, 2.0),
  ('google/gemini-2.5-pro-preview-03-25', 'OR Gemini 2.5 Pro', 1.25, 10.00, 2.0),
  -- OpenRouter (other)
  ('x-ai/grok-3', 'OR Grok 3', 3.00, 15.00, 2.0)
ON CONFLICT (model_id) DO NOTHING;

-- Extend usage_logs for token tracking
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'mcp';

-- Make api_key_id nullable (App users don't have API keys)
ALTER TABLE usage_logs ALTER COLUMN api_key_id DROP NOT NULL;
