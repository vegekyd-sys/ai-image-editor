-- Credits must be reserved atomically before an expensive provider request.
-- Never record the list price when the account could only cover part of it:
-- a later full refund would otherwise mint the uncovered difference.
CREATE OR REPLACE FUNCTION deduct_and_log(
  p_user_id UUID,
  p_amount INT,
  p_tool_name TEXT,
  p_model_used TEXT DEFAULT NULL,
  p_input_tokens INT DEFAULT NULL,
  p_output_tokens INT DEFAULT NULL,
  p_duration_ms INT DEFAULT NULL,
  p_source TEXT DEFAULT 'app',
  p_api_key_id UUID DEFAULT NULL,
  p_cache_read_tokens INT DEFAULT NULL,
  p_cache_write_tokens INT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_remaining INT;
  v_balance INT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive'
      USING ERRCODE = '22023';
  END IF;

  UPDATE credit_balances
  SET balance = balance - p_amount,
      lifetime_used = lifetime_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND balance >= p_amount
  RETURNING balance INTO v_remaining;

  IF NOT FOUND THEN
    SELECT balance INTO v_balance
    FROM credit_balances
    WHERE user_id = p_user_id;

    RAISE EXCEPTION 'insufficient_credits: balance=%, required=%',
      COALESCE(v_balance, 0), p_amount
      USING ERRCODE = 'P0001';
  END IF;

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
    cache_write_tokens
  )
  VALUES (
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
    p_cache_write_tokens
  );

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refund_credits_and_log(
  p_user_id UUID,
  p_amount INT,
  p_tool_name TEXT,
  p_source TEXT DEFAULT 'app'
) RETURNS INT AS $$
DECLARE
  v_remaining INT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'refund amount must be positive'
      USING ERRCODE = '22023';
  END IF;

  UPDATE credit_balances
  SET balance = balance + p_amount,
      lifetime_used = GREATEST(0, lifetime_used - p_amount),
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund user has no credit balance'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO usage_logs (
    user_id,
    tool_name,
    credits_charged,
    source
  )
  VALUES (
    p_user_id,
    'refund:' || p_tool_name,
    -p_amount,
    p_source
  );

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION refund_credits_and_log(UUID, INT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refund_credits_and_log(UUID, INT, TEXT, TEXT)
  TO service_role;

-- Marking a failed snapshot and refunding its reservation are one transaction.
-- The row lock makes repeated pollers idempotent: only the first caller can
-- transition a processing snapshot and return its reserved credits.
CREATE OR REPLACE FUNCTION fail_video_snapshot_and_refund(
  p_snapshot_id UUID,
  p_error TEXT DEFAULT NULL
) RETURNS TABLE (
  processed BOOLEAN,
  refunded_credits INT,
  remaining_balance INT
) AS $$
DECLARE
  v_snapshot RECORD;
  v_meta JSONB;
  v_credits INT;
  v_user_id UUID;
  v_remaining INT;
BEGIN
  SELECT id, project_id, video_meta
  INTO v_snapshot
  FROM snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_snapshot.video_meta->>'status', '') <> 'processing' THEN
    RETURN QUERY SELECT FALSE, 0, NULL::INT;
    RETURN;
  END IF;

  v_meta := COALESCE(v_snapshot.video_meta, '{}'::JSONB);
  v_credits := GREATEST(0, COALESCE((v_meta->>'creditsCharged')::INT, 0));
  v_meta := v_meta || jsonb_build_object(
    'status', 'failed',
    'refunded', v_credits > 0
  );

  IF p_error IS NOT NULL AND length(p_error) > 0 THEN
    v_meta := v_meta || jsonb_build_object('error', p_error);
  END IF;

  UPDATE snapshots
  SET video_meta = v_meta
  WHERE id = p_snapshot_id;

  IF v_credits > 0 THEN
    SELECT user_id INTO v_user_id
    FROM projects
    WHERE id = v_snapshot.project_id;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'video snapshot project has no owner'
        USING ERRCODE = 'P0002';
    END IF;

    UPDATE credit_balances
    SET balance = balance + v_credits,
        lifetime_used = GREATEST(0, lifetime_used - v_credits),
        updated_at = NOW()
    WHERE user_id = v_user_id
    RETURNING balance INTO v_remaining;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'video snapshot owner has no credit balance'
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO usage_logs (
      user_id,
      tool_name,
      credits_charged,
      source
    )
    VALUES (
      v_user_id,
      'refund:create_video',
      -v_credits,
      'app'
    );
  END IF;

  RETURN QUERY SELECT TRUE, v_credits, v_remaining;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fail_video_snapshot_and_refund(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_video_snapshot_and_refund(UUID, TEXT)
  TO service_role;
