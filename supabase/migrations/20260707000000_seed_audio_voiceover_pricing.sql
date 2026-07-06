-- Add fixed per-task billing for Volcengine / Seed TTS voiceover generation.
-- Keep supplier_cost editable in Admin because the upstream account may use
-- character packages or negotiated pricing rather than a single public rate.
DO $$
BEGIN
  IF to_regclass('public.credit_pricing') IS NOT NULL THEN
    INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
    VALUES ('create_voiceover', 0, 2, false)
    ON CONFLICT (tool_name) DO NOTHING;
  END IF;
END $$;
