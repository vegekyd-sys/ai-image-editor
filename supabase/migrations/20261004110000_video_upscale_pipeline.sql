-- Service-owned recoverable jobs. No client can mutate receipts or refunds.
CREATE TABLE public.video_upscale_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  project_id uuid REFERENCES public.projects(id),
  model_id text NOT NULL CHECK (model_id IN ('seedance-2.5-eco','bytedance-video-upscale')),
  resolution text NOT NULL CHECK (resolution IN ('1080p','2k','4k')),
  stage text NOT NULL DEFAULT 'generating' CHECK (stage IN ('generating','saving_base','ready_to_upscale','submitting_upscale','upscaling','saving_final','completed','failed','submission_uncertain')),
  generation_task_id text,
  base_provider_url text,
  base_url text,
  source_meta jsonb,
  upscale_request_id text,
  output_provider_url text,
  output_url text,
  output_meta jsonb,
  upscale_failed boolean NOT NULL DEFAULT false,
  error text,
  preset text NOT NULL DEFAULT 'general',
  reserved_upscale_credits integer NOT NULL DEFAULT 0 CHECK (reserved_upscale_credits >= 0),
  refunded_upscale_credits integer NOT NULL DEFAULT 0 CHECK (refunded_upscale_credits >= 0),
  refund_complete boolean NOT NULL DEFAULT false,
  billing_tool text NOT NULL DEFAULT 'create_video',
  billing_source text NOT NULL DEFAULT 'app' CHECK (billing_source IN ('app','mcp')),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_upscale_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_upscale_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.video_upscale_jobs TO service_role;
CREATE INDEX video_upscale_jobs_pending ON public.video_upscale_jobs(updated_at) WHERE stage NOT IN ('completed','failed');

-- Locking the root makes the partial refund idempotent across Agent/App/Cron.
CREATE FUNCTION public.refund_video_upscale_stage(p_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.video_upscale_jobs; amount integer;
BEGIN
  SELECT * INTO STRICT r FROM public.video_upscale_jobs WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT r.upscale_failed OR r.base_url IS NULL THEN RETURN; END IF;
  amount := r.reserved_upscale_credits - r.refunded_upscale_credits;
  IF amount > 0 THEN
    PERFORM public.refund_credits_and_log(r.user_id, amount, r.billing_tool, r.billing_source, NULL, r.project_id);
  END IF;
  UPDATE public.video_upscale_jobs SET refunded_upscale_credits=reserved_upscale_credits, refund_complete=true, updated_at=now() WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.refund_video_upscale_stage(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_video_upscale_stage(uuid,uuid) TO service_role;

-- fal's published Fast rates at 30fps; no guess for the unpriced 6K/8K tiers.
INSERT INTO public.media_pricing(id,kind,model_id,resolution,operation,output_usd_per_second)
VALUES
('video:bytedance-video-upscale:1080p:generate','video','bytedance-video-upscale','1080p','generate',.0072),
('video:bytedance-video-upscale:2k:generate','video','bytedance-video-upscale','2k','generate',.0144),
('video:bytedance-video-upscale:4k:generate','video','bytedance-video-upscale','4k','generate',.0288)
ON CONFLICT(id) DO NOTHING;
