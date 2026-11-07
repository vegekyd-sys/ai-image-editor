-- Attribute paid video reservations (Agent Retake and hosted MCP video) to the
-- Agent run, project and request source that made them.
--
-- Before: reserve_mcp_video always logged run_id/project_id NULL and source
-- 'mcp', so an Agent Retake charge never appeared in the run's usage summary
-- (CLI "credits used" line) even though the balance was debited.
--
-- Backward compatible: the new parameters default to the old behaviour, so a
-- deployment still calling the 7-argument form keeps working. Refund rows
-- inherit run/project from the reservation row (refund_credits_and_log) and now
-- reuse the reservation's source as well.
SET lock_timeout = '5s';

ALTER TABLE public.mcp_video_reservations
  ADD COLUMN IF NOT EXISTS billing_source text NOT NULL DEFAULT 'mcp',
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid;

DROP FUNCTION IF EXISTS public.reserve_mcp_video(uuid, uuid, uuid, text, text, text, jsonb);

CREATE FUNCTION public.reserve_mcp_video(
  p_id uuid, p_user_id uuid, p_api_key_id uuid, p_tool text, p_model text, p_fingerprint text, p_quote jsonb,
  p_source text DEFAULT 'mcp', p_run_id uuid DEFAULT NULL, p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.mcp_video_reservations; created boolean; v_source text := COALESCE(NULLIF(p_source, ''), 'mcp');
BEGIN
  IF v_source NOT IN ('app','cli','api','mcp') THEN RAISE EXCEPTION 'Invalid billing source'; END IF;
  INSERT INTO public.mcp_video_reservations (id,user_id,api_key_id,tool_name,model_id,fingerprint,quote,credits,billing_source,run_id,project_id)
  VALUES (p_id,p_user_id,p_api_key_id,p_tool,p_model,p_fingerprint,p_quote,(p_quote->>'credits')::integer,v_source,p_run_id,p_project_id)
  ON CONFLICT (id) DO NOTHING;
  created := FOUND;
  SELECT * INTO STRICT r FROM public.mcp_video_reservations WHERE id=p_id FOR UPDATE;
  IF r.user_id <> p_user_id OR r.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'Billing request conflict'; END IF;
  IF created THEN
    PERFORM public.deduct_and_log(p_user_id,r.credits,p_tool,p_model,NULL,NULL,NULL,r.billing_source,p_api_key_id,NULL,NULL,r.run_id,r.project_id);
  END IF;
  RETURN jsonb_build_object('created',created,'task_id',r.task_id,'status',r.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_mcp_video(uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_mcp_video(uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_mcp_video_submission(p_id uuid, p_user_id uuid, p_task_id text, p_state text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.mcp_video_reservations;
BEGIN
  IF p_state NOT IN ('submitted','completed','uncertain','refunded') THEN RAISE EXCEPTION 'Invalid submission state'; END IF;
  SELECT * INTO STRICT r FROM public.mcp_video_reservations WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF r.status NOT IN ('reserved','uncertain') THEN RETURN; END IF;
  IF p_state IN ('submitted','completed') AND p_task_id IS NULL THEN RAISE EXCEPTION 'Missing provider task'; END IF;
  IF p_state='refunded' THEN
    PERFORM public.refund_credits_and_log(p_user_id,r.credits,r.tool_name,r.billing_source,r.run_id,r.project_id);
  END IF;
  UPDATE public.mcp_video_reservations SET status=p_state, task_id=p_task_id, updated_at=now() WHERE id=p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_mcp_video(p_user_id uuid, p_task_id text, p_failed boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.mcp_video_reservations;
BEGIN
  SELECT * INTO r FROM public.mcp_video_reservations WHERE user_id=p_user_id AND task_id=p_task_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'submitted' THEN RETURN; END IF;
  IF p_failed THEN
    PERFORM public.refund_credits_and_log(p_user_id,r.credits,r.tool_name,r.billing_source,r.run_id,r.project_id);
  END IF;
  UPDATE public.mcp_video_reservations SET status=CASE WHEN p_failed THEN 'refunded' ELSE 'completed' END, updated_at=now() WHERE id=r.id;
END;
$function$;

-- Refunds must offset the reservation of the same run first. The previous
-- ordering evaluated to NULL for rows without run_id, and NULL sorts first in
-- DESC order, so a refund carrying p_run_id offset an older unattributed row.
-- Live definition preserved; only the ORDER BY changes.
CREATE OR REPLACE FUNCTION public.refund_credits_and_log(p_user_id uuid, p_amount integer, p_tool_name text, p_source text DEFAULT 'app'::text, p_run_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining integer;
  v_trial_expires_at timestamptz;
  v_trial_active boolean;
  v_trial_refund integer := 0;
  v_remaining_to_allocate integer;
  v_row_refund integer;
  v_row_trial_refund integer;
  v_usage record;
  v_run_id uuid := p_run_id;
  v_project_id uuid := p_project_id;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'refund amount must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT trial_expires_at
  INTO v_trial_expires_at
  FROM credit_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund user has no credit balance' USING ERRCODE = 'P0002';
  END IF;

  v_trial_active := v_trial_expires_at IS NOT NULL AND v_trial_expires_at > now();
  v_remaining_to_allocate := p_amount;

  -- Offset the most recent open reservation for this tool, preferring the
  -- reservation made by the same run so the refund stays attributed to it.
  FOR v_usage IN
    SELECT id, credits_charged, trial_credits_charged, refunded_credits, run_id, project_id
    FROM usage_logs
    WHERE user_id = p_user_id
      AND tool_name = p_tool_name
      AND credits_charged > 0
      AND refunded_credits < credits_charged
    ORDER BY COALESCE(p_run_id IS NOT NULL AND run_id = p_run_id, false) DESC, created_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;

    v_row_refund := LEAST(
      v_remaining_to_allocate,
      v_usage.credits_charged - v_usage.refunded_credits
    );
    v_row_trial_refund := LEAST(
      v_row_refund,
      GREATEST(
        0,
        v_usage.trial_credits_charged
          - LEAST(v_usage.trial_credits_charged, v_usage.refunded_credits)
      )
    );

    UPDATE usage_logs
    SET refunded_credits = refunded_credits + v_row_refund
    WHERE id = v_usage.id;

    -- Inherit attribution from the reservation being refunded when the caller
    -- did not know the run (for example async video failure cleanup).
    IF v_run_id IS NULL THEN v_run_id := v_usage.run_id; END IF;
    IF v_project_id IS NULL THEN v_project_id := v_usage.project_id; END IF;

    v_trial_refund := v_trial_refund + v_row_trial_refund;
    v_remaining_to_allocate := v_remaining_to_allocate - v_row_refund;
  END LOOP;

  IF NOT v_trial_active AND v_trial_expires_at IS NOT NULL THEN
    UPDATE credit_balances
    SET balance = GREATEST(0, balance - trial_balance),
        trial_balance = 0,
        trial_expires_at = NULL,
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  UPDATE credit_balances
  SET balance = balance + p_amount - CASE WHEN v_trial_active THEN 0 ELSE v_trial_refund END,
      trial_balance = trial_balance + CASE WHEN v_trial_active THEN v_trial_refund ELSE 0 END,
      lifetime_used = GREATEST(0, lifetime_used - p_amount),
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_remaining;

  INSERT INTO usage_logs (
    user_id,
    tool_name,
    credits_charged,
    source,
    trial_credits_charged,
    run_id,
    project_id
  ) VALUES (
    p_user_id,
    'refund:' || p_tool_name,
    -p_amount,
    p_source,
    -v_trial_refund,
    v_run_id,
    v_project_id
  );

  RETURN v_remaining;
END;
$function$;
