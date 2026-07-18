-- Azure OpenAI native web search is billed per provider-executed transaction.
-- $0.014 supplier cost x 2 markup rounds to 3 Makaron credits.
DO $$
BEGIN
  IF to_regclass('public.credit_pricing') IS NOT NULL THEN
    INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
    VALUES ('web_search', 0.014, 3, false)
    ON CONFLICT (tool_name) DO NOTHING;
  END IF;
END $$;
