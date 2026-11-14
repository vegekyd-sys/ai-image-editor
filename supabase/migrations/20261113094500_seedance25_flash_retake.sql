-- Add Flash without removing any historical or concurrently added Retake model.
-- No row, pricing, permission or default-model changes.
SET lock_timeout = '5s';
DO $migration$
DECLARE existing_check text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT existing_check
  FROM pg_constraint
  WHERE conrelid='public.video_retake_jobs'::regclass
    AND conname='video_retake_jobs_model_id_check';
  IF position('seedance-2.5-flash' in existing_check) = 0 THEN
    EXECUTE 'ALTER TABLE public.video_retake_jobs DROP CONSTRAINT video_retake_jobs_model_id_check';
    EXECUTE format('ALTER TABLE public.video_retake_jobs ADD CONSTRAINT video_retake_jobs_model_id_check CHECK (%s OR model_id = %L) NOT VALID',
      regexp_replace(existing_check, '^CHECK ', ''), 'seedance-2.5-flash');
    ALTER TABLE public.video_retake_jobs VALIDATE CONSTRAINT video_retake_jobs_model_id_check;
  END IF;
END
$migration$;
