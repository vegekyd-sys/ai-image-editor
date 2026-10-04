-- EvoLink Seedance 2.5 rate card checked 2026-10-04:
-- https://evolink.ai/seedance-2-5
-- Optional, so existing/custom tariffs keep their previous billing contract.
ALTER TABLE public.media_pricing ADD COLUMN video_reference_usd_per_second numeric
  CHECK (video_reference_usd_per_second > 0);
COMMENT ON COLUMN public.media_pricing.video_reference_usd_per_second IS
  'Seedance 2.5 video input tariff: (max(total input seconds, output seconds) + output seconds) * rate. NULL preserves legacy billing.';

-- Only replace untouched legacy Seedance prices; preserve operator overrides,
-- markup and enablement. Deploy the new quoting code before applying this migration.
UPDATE public.media_pricing SET
  output_usd_per_second = CASE resolution WHEN '480p' THEN 0.138 ELSE 0.296 END,
  video_reference_usd_per_second = CASE resolution WHEN '480p' THEN 0.084 ELSE 0.180 END,
  updated_at = now()
WHERE model_id = 'seedance-2.5' AND resolution IN ('480p', '720p')
  AND output_usd_per_second = CASE resolution WHEN '480p' THEN 0.275 ELSE 0.325 END
  AND input_usd_per_second = 0 AND input_usd_per_image = 0;
