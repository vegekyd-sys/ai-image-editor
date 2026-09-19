-- Capacity-weighted Remotion queue. The advisory transaction lock makes the
-- read-active-capacity + claim operation atomic across Vercel, cron, and workers.
CREATE OR REPLACE FUNCTION public.claim_remotion_export_job_with_capacity(
  p_worker_id text,
  p_capacity_limit integer DEFAULT 330,
  p_stale_cutoff timestamptz DEFAULT now() - interval '2 minutes',
  p_job_id uuid DEFAULT NULL,
  p_legacy_job_slots integer DEFAULT 46
)
RETURNS SETOF public.remotion_export_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_slots integer := 0;
  v_capacity_limit integer := GREATEST(1, p_capacity_limit);
  v_legacy_job_slots integer := GREATEST(1, p_legacy_job_slots);
  v_candidate public.remotion_export_jobs%ROWTYPE;
  v_candidate_slots integer;
  v_claimed_at timestamptz := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('remotion-export-capacity-v1'));

  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(j.metadata->>'estimatedLambdaSlots', '') ~ '^[1-9][0-9]{0,5}$'
        THEN GREATEST(1, (j.metadata->>'estimatedLambdaSlots')::integer)
      ELSE v_legacy_job_slots
    END
  ), 0)::integer
  INTO v_active_slots
  FROM public.remotion_export_jobs j
  WHERE j.status = 'rendering'
    AND COALESCE(j.heartbeat_at, j.started_at, j.created_at) >= p_stale_cutoff;

  SELECT j.*
  INTO v_candidate
  FROM public.remotion_export_jobs j
  WHERE
    (p_job_id IS NULL OR j.id = p_job_id)
    AND (
      j.status = 'queued'
      OR (
        j.status = 'rendering'
        AND COALESCE(j.heartbeat_at, j.started_at, j.created_at) < p_stale_cutoff
      )
    )
    AND (
      v_active_slots = 0
      OR v_active_slots + CASE
        WHEN COALESCE(j.metadata->>'estimatedLambdaSlots', '') ~ '^[1-9][0-9]{0,5}$'
          THEN GREATEST(1, (j.metadata->>'estimatedLambdaSlots')::integer)
        ELSE v_legacy_job_slots
      END <= v_capacity_limit
    )
  ORDER BY
    CASE WHEN j.status = 'queued' THEN 0 ELSE 1 END,
    CASE WHEN j.status = 'queued' THEN j.created_at END ASC,
    COALESCE(j.heartbeat_at, j.started_at, j.created_at) ASC
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1;

  IF v_candidate.id IS NULL THEN
    RETURN;
  END IF;

  v_candidate_slots := CASE
    WHEN COALESCE(v_candidate.metadata->>'estimatedLambdaSlots', '') ~ '^[1-9][0-9]{0,5}$'
      THEN GREATEST(1, (v_candidate.metadata->>'estimatedLambdaSlots')::integer)
    ELSE v_legacy_job_slots
  END;

  RETURN QUERY
  UPDATE public.remotion_export_jobs j
  SET status = 'rendering',
      progress = 0,
      started_at = v_claimed_at,
      completed_at = NULL,
      error = NULL,
      worker_id = p_worker_id,
      heartbeat_at = v_claimed_at,
      metadata = COALESCE(j.metadata, '{}'::jsonb) || jsonb_build_object(
        'capacityClaimedAt', v_claimed_at,
        'capacityLimit', v_capacity_limit,
        'capacityActiveSlotsBeforeClaim', v_active_slots,
        'capacityClaimedSlots', v_candidate_slots
      )
  WHERE j.id = v_candidate.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_remotion_export_job_with_capacity(text, integer, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_remotion_export_job_with_capacity(text, integer, timestamptz, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_remotion_export_job_with_capacity(text, integer, timestamptz, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_remotion_export_job_with_capacity(text, integer, timestamptz, uuid, integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_rendering_heartbeat
  ON public.remotion_export_jobs(heartbeat_at ASC)
  WHERE status = 'rendering';
