-- Additive Eco tariffs avoid changing native Seedance prices in the shared DB.
ALTER TABLE public.media_pricing ADD COLUMN IF NOT EXISTS video_reference_usd_per_second numeric CHECK (video_reference_usd_per_second > 0);
ALTER TABLE public.video_upscale_jobs DROP CONSTRAINT video_upscale_jobs_resolution_check;
ALTER TABLE public.video_upscale_jobs ADD CONSTRAINT video_upscale_jobs_resolution_check CHECK (resolution IN ('720p','1080p','2k','4k'));
INSERT INTO public.media_pricing(id,kind,model_id,resolution,operation,output_usd_per_second,video_reference_usd_per_second,unfiltered_multiplier)
VALUES ('video:seedance-2.5-eco:480p:generate','video','seedance-2.5-eco','480p','generate',0.138,0.084,1.1)
ON CONFLICT(id) DO NOTHING;
-- 720p uses the 1080p supplier tier and a local Lanczos delivery encode.
INSERT INTO public.media_pricing(id,kind,model_id,resolution,operation,output_usd_per_second)
VALUES ('video:bytedance-video-upscale:720p:generate','video','bytedance-video-upscale','720p','generate',0.0072)
ON CONFLICT(id) DO NOTHING;
