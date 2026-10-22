-- Add supported native-edit/reference-rebuild routes; preserve every historical model.
SET lock_timeout = '5s';
ALTER TABLE public.video_retake_jobs DROP CONSTRAINT video_retake_jobs_model_id_check;
ALTER TABLE public.video_retake_jobs ADD CONSTRAINT video_retake_jobs_model_id_check
CHECK (model_id IN ('seedance-2.5-eco','seedance-2.5','fal-h3-max','ltx-2.3-retake','kling-4','wan-3.0','wan-3.0-prime','grok','google-omni','minimax-h3'));
