-- Wan 2.7 Image, Alibaba international / Singapore, verified 2026-09-03.
-- https://www.alibabacloud.com/help/zh/model-studio/model-pricing
-- Standard model only, one output per call: $0.03 × 2 markup / $0.01 = 6 credits.
-- Input images/tokens are not billed. Free trial allowances do not change list pricing.
-- Preserve an administrator's existing price when rerun.
INSERT INTO public.credit_pricing (tool_name, supplier_cost, credits, is_free)
VALUES ('edit_image_wan2.7-image', 0.03, 6, false)
ON CONFLICT (tool_name) DO NOTHING;
