-- Kling 4.0 Flash via EvoLink. Additive and backward compatible; apply with the authorized release.
-- Rate card checked 2026-11-06: https://evolink.ai/kling-4-0-flash
--   text / image-only reference: $0.094 per output second (720p only)
--   reference video or video edit: $0.063 x (output + max(rounded video seconds, output))
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,video_reference_usd_per_second)
VALUES
('video:kling-4-flash:720p:generate','video','kling-4-flash','720p','generate',0.094,0.063),
('video:kling-4-flash:720p:edit','video','kling-4-flash','720p','edit',0.094,0.063)
ON CONFLICT (id) DO NOTHING;

-- Allow Flash Retake receipts; preserve every historical model.
SET lock_timeout = '5s';
ALTER TABLE public.video_retake_jobs DROP CONSTRAINT video_retake_jobs_model_id_check;
ALTER TABLE public.video_retake_jobs ADD CONSTRAINT video_retake_jobs_model_id_check
CHECK (model_id IN ('seedance-2.5-eco','seedance-2.5','fal-h3-max','ltx-2.3-retake','kling-4','kling-4-flash','wan-3.0','wan-3.0-prime','grok','google-omni','minimax-h3'));
