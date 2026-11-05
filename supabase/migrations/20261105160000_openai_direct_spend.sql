-- Ledger for the owner's direct OpenAI API key (monthly prepaid budget).
-- OpenAI does not expose remaining credit to a project key without the
-- api.usage.read scope, so Makaron records its own supplier cost per call and
-- routes GPT Agent models and GPT Image 2.6 to OpenAI first while the current
-- UTC month stays under budget. kind='quota_exhausted' rows mark a month in
-- which OpenAI itself refused further usage.
CREATE TABLE IF NOT EXISTS public.openai_direct_spend (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  kind text NOT NULL CHECK (kind IN ('agent', 'image', 'quota_exhausted')),
  model text NOT NULL,
  usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (usd >= 0),
  input_tokens integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  request_id text,
  detail text
);

CREATE INDEX IF NOT EXISTS openai_direct_spend_month_idx
  ON public.openai_direct_spend (month, kind);

ALTER TABLE public.openai_direct_spend ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (server) reads or writes this ledger.

CREATE OR REPLACE FUNCTION public.openai_direct_month_state(p_month text)
RETURNS TABLE (spent_usd numeric, exhausted boolean, calls bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(usd), 0)::numeric AS spent_usd,
    COALESCE(BOOL_OR(kind = 'quota_exhausted'), false) AS exhausted,
    COUNT(*) FILTER (WHERE kind <> 'quota_exhausted') AS calls
  FROM public.openai_direct_spend
  WHERE month = p_month;
$$;

REVOKE ALL ON FUNCTION public.openai_direct_month_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.openai_direct_month_state(text) TO service_role;
