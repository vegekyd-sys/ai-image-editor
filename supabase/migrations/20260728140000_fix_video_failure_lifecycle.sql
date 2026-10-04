-- snapshots.id is TEXT, not UUID. The previous UUID parameter made every
-- terminal video transition fail with "operator does not exist: text = uuid".
DROP FUNCTION IF EXISTS fail_video_snapshot_and_refund(UUID, TEXT);

CREATE OR REPLACE FUNCTION fail_video_snapshot_and_refund(
  p_snapshot_id TEXT,
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

REVOKE ALL ON FUNCTION fail_video_snapshot_and_refund(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_video_snapshot_and_refund(TEXT, TEXT)
  TO service_role;
