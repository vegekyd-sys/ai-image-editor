-- 2026-10-23 fal reference-to-video tariff: 1080p shares 768p input charging.
-- This duration coefficient is the existing conservative 30fps quote estimate;
-- fal exact tokens vary by frame count/aspect and are not a flat per-second tariff.
SET lock_timeout = '5s';
ALTER TABLE public.video_retake_jobs DROP CONSTRAINT video_retake_jobs_model_id_check;
ALTER TABLE public.video_retake_jobs ADD CONSTRAINT video_retake_jobs_model_id_check
CHECK (model_id IN ('seedance-2.5-eco','seedance-2.5','fal-h3-max','ltx-2.3-retake','kling-4','wan-3.0','wan-3.0-prime'));
UPDATE public.media_pricing SET input_tokens_per_video_second=7459.2,updated_at=now()
WHERE id='video:fal-h3-max:1080p:generate' AND model_id='fal-h3-max'
AND input_tokens_per_video_second=0;
