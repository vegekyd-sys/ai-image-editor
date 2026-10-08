-- Align durable receipts with the supported Eco editing route. Retain the
-- retired LTX value for existing receipts; application routing excludes it.
ALTER TABLE public.video_retake_jobs
  DROP CONSTRAINT video_retake_jobs_model_id_check;
ALTER TABLE public.video_retake_jobs
  ADD CONSTRAINT video_retake_jobs_model_id_check
  CHECK (model_id IN ('seedance-2.5-eco', 'seedance-2.5', 'fal-h3-max', 'ltx-2.3-retake'));
