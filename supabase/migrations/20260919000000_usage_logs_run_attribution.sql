-- Attribute every credit debit/refund to the Agent run and project that caused it.
-- This lets the CLI (`makaron chat`, `responses get`) and the API
-- (`/api/agent/run/[id]`, `/api/billing/usage`) report per-run credit usage.
--
-- Backward compatible: the new RPC parameters default to NULL, so callers that
-- have not been upgraded keep working. The old 11-parameter signature is
-- dropped first so PostgREST does not see two overloads.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid;

CREATE INDEX IF NOT EXISTS idx_usage_logs_run_id
  ON usage_logs(run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_project_created
  ON usage_logs(user_id, project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

DROP FUNCTION IF EXISTS deduct_and_log(uuid, integer, text, text, integer, integer, integer, text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION deduct_and_log(
  p_user_id uuid,
  p_amount integer,
  p_tool_name text,
  p_model_used text DEFAULT NULL,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_source text DEFAULT 'app',
  p_api_key_id uuid DEFAULT NULL,
  p_cache_read_tokens integer DEFAULT NULL,
  p_cache_write_tokens integer DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL
) RETURNS integer AS $$
DECLARE
  v_remaining integer;
  v_balance integer;
  v_trial_balance integer;
  v_trial_charged integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive' USING ERRCODE = '22023';
  END IF;

  UPDATE credit_balances
  SET balance = GREATEST(0, balance - trial_balance),
      trial_balance = 0,
      trial_expires_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND trial_expires_at IS NOT NULL
    AND trial_expires_at <= now();

  SELECT balance, trial_balance
  INTO v_balance, v_trial_balance
  FROM credit_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits: balance=%, required=%',
      COALESCE(v_balance, 0), p_amount
      USING ERRCODE = 'P0001';
  END IF;

  v_trial_charged := LEAST(v_trial_balance, p_amount);

  UPDATE credit_balances
  SET balance = balance - p_amount,
      trial_balance = trial_balance - v_trial_charged,
      lifetime_used = lifetime_used + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_remaining;

  INSERT INTO usage_logs (
    user_id,
    api_key_id,
    tool_name,
    model_used,
    credits_charged,
    input_tokens,
    output_tokens,
    duration_ms,
    source,
    cache_read_tokens,
    cache_write_tokens,
    trial_credits_charged,
    run_id,
    project_id
  ) VALUES (
    p_user_id,
    p_api_key_id,
    p_tool_name,
    p_model_used,
    p_amount,
    p_input_tokens,
    p_output_tokens,
    p_duration_ms,
    p_source,
    p_cache_read_tokens,
    p_cache_write_tokens,
    v_trial_charged,
    p_run_id,
    p_project_id
  );

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

DROP FUNCTION IF EXISTS refund_credits_and_log(uuid, integer, text, text);

CREATE OR REPLACE FUNCTION refund_credits_and_log(
  p_user_id uuid,
  p_amount integer,
  p_tool_name text,
  p_source text DEFAULT 'app',
  p_run_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL
) RETURNS integer AS $$
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
    ORDER BY (p_run_id IS NOT NULL AND run_id = p_run_id) DESC, created_at DESC, id DESC
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
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION refund_credits_and_log(uuid, integer, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refund_credits_and_log(uuid, integer, text, text, uuid, uuid)
  TO service_role;
