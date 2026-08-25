DO $$
BEGIN
  IF to_regclass('public.credit_pricing') IS NOT NULL THEN
    INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
    VALUES ('edit_image_openai', 0.02, 4, false)
    ON CONFLICT (tool_name) DO NOTHING;
  END IF;
END $$;
