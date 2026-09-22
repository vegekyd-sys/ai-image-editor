-- Qwen Image Edit Spicy via MuleRouter, verified 2026-09-22.
-- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/qwen-image-edit-spicy/generation
-- Base single-image edit: $0.04. Additional reference images cost $0.003
-- each (maximum three total images). The fixed 8-credit product price is the
-- standard 2x markup for the primary single-image path and still covers the
-- two- and three-image supplier surcharges.
INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
VALUES ('edit_image_qwen-spicy', 0.04, 8, false)
ON CONFLICT (tool_name) DO NOTHING;
