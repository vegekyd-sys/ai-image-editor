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

-- Seed initial token rates
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup) VALUES
  -- Bedrock
  ('us.anthropic.claude-opus-4-6-v1', 'Claude Opus 4.6', 15.00, 75.00, 2.0),
  ('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5', 3.00, 15.00, 2.0),
  -- Google direct
  ('gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash', 0.10, 0.40, 2.0),
  ('gemini-3-pro-image-preview', 'Gemini 3 Pro', 1.25, 5.00, 2.0),
  -- OpenRouter (Google Gemini)
  ('google/gemini-3.1-flash-image-preview', 'OR Gemini 3.1 Flash', 0.10, 0.40, 2.0),
  ('google/gemini-3-pro-image-preview', 'OR Gemini 3 Pro', 1.25, 5.00, 2.0),
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
