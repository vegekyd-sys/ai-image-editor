-- MuleRouter CarrotHub Spicy has different generation/edit and input-count costs.
-- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/z-image-spicy/generation
-- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/qwen-image-edit-spicy/generation
-- One-image edit remains in 20260922123000_qwen_spicy_pricing.sql.
-- Z-Image prompt rewriting is disabled by default; if enabled, re-evaluate cost.
INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
VALUES
  ('generate_image_qwen-spicy', 0.013, 3, false),
  ('edit_image_qwen-spicy-2', 0.043, 9, false),
  ('edit_image_qwen-spicy-3', 0.046, 10, false)
ON CONFLICT (tool_name) DO UPDATE SET
  supplier_cost = EXCLUDED.supplier_cost,
  credits = EXCLUDED.credits,
  is_free = EXCLUDED.is_free;
