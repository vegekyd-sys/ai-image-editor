-- Durable, service-owned Retake receipts. Client roles cannot alter paid jobs.
CREATE TABLE public.video_retake_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  project_id uuid REFERENCES public.projects(id),
  fingerprint text NOT NULL,
  source_url text NOT NULL,
  instruction text NOT NULL,
  model_id text NOT NULL CHECK (model_id IN ('seedance-2.5','fal-h3-max','ltx-2.3-retake')),
  resolution text NOT NULL,
  plan jsonb NOT NULL,
  source_meta jsonb NOT NULL,
  stage text NOT NULL CHECK (stage IN ('preparing','prepared','submitting','generating','saving_patch','assembling','completed','failed','submission_uncertain')),
  context_url text,
  provider_task_id text,
  patch_url text,
  output_url text,
  error text,
  timings jsonb NOT NULL DEFAULT '{}',
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_retake_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_retake_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.video_retake_jobs TO service_role;
CREATE INDEX video_retake_pending_idx ON public.video_retake_jobs(updated_at)
  WHERE stage IN ('generating','saving_patch','assembling');
CREATE INDEX video_retake_owner_idx ON public.video_retake_jobs(user_id, created_at DESC);

-- fal LTX 2.3 Retake published rate, verified 2026-10-07. Resolution is
-- inherited from the source; 720p is only this route's pricing key.
INSERT INTO public.media_pricing(id,kind,model_id,resolution,operation,output_usd_per_second)
VALUES ('video:ltx-2.3-retake:720p:edit','video','ltx-2.3-retake','720p','edit',.10)
ON CONFLICT(id) DO NOTHING;
