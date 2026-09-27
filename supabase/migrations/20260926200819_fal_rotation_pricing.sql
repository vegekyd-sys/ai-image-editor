-- fal Qwen Image Edit 2511 Multiple-Angles LoRA, $0.035 per output MP.
-- The adapter caps output at 1 MP. 7 credits is 2x supplier cost at
-- the nominal $0.01/credit rate (discounted bundles have a lower ratio).
-- Separate SKU: production Vast keeps rotate_camera at its existing price.
INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
VALUES ('rotate_camera_fal', 0.035, 7, false)
ON CONFLICT (tool_name) DO UPDATE SET
  supplier_cost = EXCLUDED.supplier_cost,
  credits = EXCLUDED.credits,
  is_free = EXCLUDED.is_free;
