-- Disposable makaron-gpt26-e2e ONLY. Never apply this fixture to shared environments.
CREATE TABLE IF NOT EXISTS public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),key_hash text UNIQUE NOT NULL,key_prefix text NOT NULL,name text,is_active boolean DEFAULT true,last_used_at timestamptz,created_at timestamptz DEFAULT now());
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, api_key_id uuid, tool_name text, model_used text, credits_charged integer, input_tokens integer, output_tokens integer, duration_ms integer, source text, cache_read_tokens integer, cache_write_tokens integer, trial_credits_charged integer DEFAULT 0, refunded_credits integer DEFAULT 0, created_at timestamptz DEFAULT now());
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.credit_pricing (tool_name text PRIMARY KEY, supplier_cost numeric DEFAULT 0, credits integer, is_free boolean DEFAULT false);
ALTER TABLE public.credit_pricing ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.api_keys, public.usage_logs, public.credit_pricing TO service_role;
