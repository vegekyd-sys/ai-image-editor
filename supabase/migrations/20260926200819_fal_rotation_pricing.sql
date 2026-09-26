-- fal Qwen Image Edit 2511 Multiple-Angles LoRA, $0.035 per output MP.
-- The adapter caps output at 1 MP, so 7 credits is at least 2x supplier cost.
-- Apply with the candidate release, not while production still uses Vast.
INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
VALUES ('rotate_camera', 0.035, 7, false)
ON CONFLICT (tool_name) DO UPDATE SET
  supplier_cost = EXCLUDED.supplier_cost,
  credits = EXCLUDED.credits,
  is_free = EXCLUDED.is_free;
