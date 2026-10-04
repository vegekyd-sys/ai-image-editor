-- Shared DB: local and Preview runs must never be claimed by production workers.
-- Only new, origin-pinned runs opt in. Existing runs and old deployments retain
-- their current behavior so this migration does not interrupt active jobs.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_agent_execution_for_origin(
  p_run_id uuid,
  p_worker_id text,
  p_origin text,
  p_lease_seconds integer DEFAULT 480
)
RETURNS TABLE (
  run_id uuid, lease_token uuid, attempt_no integer, user_id uuid,
  project_id uuid, objective text, acceptance_criteria jsonb,
  execution_policy jsonb, metadata jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
  v_origin text := rtrim(p_origin, '/');
BEGIN
  RETURN QUERY
  UPDATE public.agent_runs r
  SET lease_token = v_token,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(60, LEAST(p_lease_seconds, 900))),
      next_attempt_at = NULL,
      attempt_count = r.attempt_count + 1
  WHERE r.id = p_run_id
    AND r.status = 'running'
    AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
    AND (
      -- Unpinned jobs predate this contract; preserve existing recovery behavior.
      (p_origin IS NULL AND r.metadata ->> 'executionOwnerOrigin' IS NULL)
      OR
      -- Old workers cannot claim new pinned local/Preview jobs.
      ((p_origin IS NULL OR v_origin IN ('https://www.makaron.app', 'https://makaron.app'))
        AND COALESCE(r.metadata ->> 'executionOwnerOrigin', r.metadata #>> '{executionRequest,origin}', '')
          IN ('', 'https://www.makaron.app', 'https://makaron.app'))
      OR
      (p_origin IS NOT NULL AND v_origin <> ''
        AND rtrim(COALESCE(r.metadata ->> 'executionOwnerOrigin', r.metadata #>> '{executionRequest,origin}'), '/') = v_origin)
    )
  RETURNING r.id, v_token, r.attempt_count, r.user_id, r.project_id,
            COALESCE(r.objective, r.prompt), r.acceptance_criteria,
            r.execution_policy, r.metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_execution_for_origin(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_agent_execution_for_origin(uuid,text,text,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_agent_execution(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 480
)
RETURNS TABLE (
  run_id uuid, lease_token uuid, attempt_no integer, user_id uuid,
  project_id uuid, objective text, acceptance_criteria jsonb,
  execution_policy jsonb, metadata jsonb
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.claim_agent_execution_for_origin(p_run_id, p_worker_id, NULL, p_lease_seconds);
$$;

COMMIT;
