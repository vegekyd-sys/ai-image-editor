-- iOS signup and Apple introductory-trial credits are intentionally separate
-- from Web welcome credits. This migration is compatible with databases that
-- already received the earlier experimental Apple-trial migrations.

INSERT INTO app_settings (key, value, updated_at)
VALUES ('ios_trial_credits', '1500', now())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE credit_balances
  ADD COLUMN IF NOT EXISTS trial_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS trial_credits_charged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_credits integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS welcome_credit_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  grant_channel text NOT NULL CHECK (
    grant_channel IN ('web_signup', 'ios_signup', 'agent_registration', 'legacy_auto')
  ),
  lifetime_used_at_claim integer NOT NULL DEFAULT 0,
  apple_original_transaction_id text UNIQUE,
  apple_transaction_id text UNIQUE,
  trial_expires_at timestamptz,
  apple_linked_at timestamptz,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE welcome_credit_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE welcome_credit_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE welcome_credit_claims TO service_role;

INSERT INTO welcome_credit_claims (
  user_id,
  credits_granted,
  grant_channel,
  lifetime_used_at_claim,
  claimed_at
)
SELECT DISTINCT ON (cp.user_id)
  cp.user_id,
  cp.credits,
  'web_signup',
  COALESCE(cb.lifetime_used, 0) + cp.credits,
  cp.created_at
FROM credit_purchases cp
LEFT JOIN credit_balances cb ON cb.user_id = cp.user_id
WHERE cp.source = 'welcome'
  AND cp.status = 'completed'
  AND cp.credits > 0
ORDER BY cp.user_id, cp.created_at, cp.id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION claim_welcome_credits(
  p_user_id uuid,
  p_credits integer,
  p_channel text
) RETURNS jsonb AS $$
DECLARE
  v_balance integer;
  v_lifetime_used integer;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'credits must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_channel NOT IN ('web_signup', 'ios_signup', 'agent_registration', 'legacy_auto') THEN
    RAISE EXCEPTION 'unsupported welcome credit channel' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('welcome-credit-user:' || p_user_id::text));

  IF EXISTS (SELECT 1 FROM welcome_credit_claims WHERE user_id = p_user_id) THEN
    SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
    RETURN jsonb_build_object(
      'granted', false,
      'credits', 0,
      'balance', COALESCE(v_balance, 0),
      'reason', 'already_claimed'
    );
  END IF;

  SELECT COALESCE(lifetime_used, 0) INTO v_lifetime_used
  FROM credit_balances
  WHERE user_id = p_user_id;

  INSERT INTO welcome_credit_claims (
    user_id,
    credits_granted,
    grant_channel,
    lifetime_used_at_claim
  ) VALUES (
    p_user_id,
    p_credits,
    p_channel,
    COALESCE(v_lifetime_used, 0)
  );

  INSERT INTO credit_purchases (
    user_id,
    stripe_session_id,
    credits,
    amount_usd,
    status,
    source
  ) VALUES (
    p_user_id,
    'welcome_' || p_user_id::text,
    p_credits,
    0,
    'completed',
    'welcome'
  );

  INSERT INTO credit_balances (
    user_id,
    balance,
    lifetime_purchased,
    lifetime_used,
    updated_at
  ) VALUES (
    p_user_id,
    p_credits,
    p_credits,
    0,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET balance = credit_balances.balance + EXCLUDED.balance,
      lifetime_purchased = credit_balances.lifetime_purchased + EXCLUDED.lifetime_purchased,
      updated_at = now()
  RETURNING balance INTO v_balance;

  RETURN jsonb_build_object(
    'granted', true,
    'credits', p_credits,
    'balance', v_balance,
    'reason', 'granted'
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION claim_welcome_credits(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_welcome_credits(uuid, integer, text)
  TO service_role;

CREATE TABLE IF NOT EXISTS apple_trial_credit_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  apple_original_transaction_id text NOT NULL UNIQUE,
  apple_transaction_id text NOT NULL UNIQUE,
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  trial_expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE apple_trial_credit_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE apple_trial_credit_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE apple_trial_credit_claims TO service_role;

-- Historical verified trial purchases block a new claim but do not receive a
-- retroactive 1,500-credit grant.
INSERT INTO apple_trial_credit_claims (
  user_id,
  apple_original_transaction_id,
  apple_transaction_id,
  credits_granted,
  trial_expires_at,
  claimed_at
)
SELECT DISTINCT ON (cp.user_id)
  cp.user_id,
  cp.apple_original_transaction_id,
  cp.apple_transaction_id,
  cp.credits,
  COALESCE(s.trial_ends_at, s.current_period_end, cp.created_at + interval '3 days'),
  cp.created_at
FROM credit_purchases cp
LEFT JOIN subscriptions s ON s.user_id = cp.user_id
WHERE cp.provider = 'apple'
  AND cp.source = 'trial'
  AND cp.status = 'completed'
  AND cp.credits > 0
  AND cp.apple_original_transaction_id IS NOT NULL
  AND cp.apple_transaction_id IS NOT NULL
ORDER BY cp.user_id, cp.created_at, cp.id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION grant_apple_credits_and_record_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_usd numeric,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_environment text,
  p_source text,
  p_trial_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_existing_id uuid;
  v_existing_user_id uuid;
  v_new_purchase_id uuid;
  v_new_balance integer;
  v_first_paid_subscription boolean := false;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'credits must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_source NOT IN ('trial', 'subscription', 'subscription_annual', 'topup') THEN
    RAISE EXCEPTION 'unsupported Apple credit source' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('apple:' || p_transaction_id));

  SELECT id, user_id INTO v_existing_id, v_existing_user_id
  FROM credit_purchases
  WHERE apple_transaction_id = p_transaction_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_user_id <> p_user_id THEN
      RAISE EXCEPTION 'Apple transaction is already linked to another Makaron account'
        USING ERRCODE = '23505';
    END IF;
    SELECT balance INTO v_new_balance FROM credit_balances WHERE user_id = p_user_id;
    RETURN jsonb_build_object(
      'granted', false,
      'processed', false,
      'balance', COALESCE(v_new_balance, 0),
      'purchase_id', v_existing_id,
      'first_paid_subscription', false,
      'reason', 'transaction_already_processed'
    );
  END IF;

  IF p_source = 'trial' THEN
    IF p_trial_expires_at IS NULL THEN
      RAISE EXCEPTION 'trial expiry is required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('apple-trial-user:' || p_user_id::text));
    PERFORM pg_advisory_xact_lock(hashtext('apple-trial-original:' || p_original_transaction_id));

    IF EXISTS (
      SELECT 1
      FROM apple_trial_credit_claims
      WHERE apple_original_transaction_id = p_original_transaction_id
        AND user_id <> p_user_id
    ) OR EXISTS (
      SELECT 1
      FROM credit_purchases
      WHERE provider = 'apple'
        AND source = 'trial'
        AND status = 'completed'
        AND apple_original_transaction_id = p_original_transaction_id
        AND user_id <> p_user_id
    ) THEN
      RAISE EXCEPTION 'Apple trial is already linked to another Makaron account'
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM credit_purchases
      WHERE user_id = p_user_id
        AND provider = 'apple'
        AND source = 'trial'
        AND status = 'completed'
    ) OR EXISTS (
      SELECT 1 FROM apple_trial_credit_claims WHERE user_id = p_user_id
    ) THEN
      SELECT balance INTO v_new_balance FROM credit_balances WHERE user_id = p_user_id;
      RETURN jsonb_build_object(
        'granted', false,
        'processed', false,
        'credits', 0,
        'balance', COALESCE(v_new_balance, 0),
        'first_paid_subscription', false,
        'reason', 'trial_already_claimed'
      );
    END IF;

    INSERT INTO apple_trial_credit_claims (
      user_id,
      apple_original_transaction_id,
      apple_transaction_id,
      credits_granted,
      trial_expires_at
    ) VALUES (
      p_user_id,
      p_original_transaction_id,
      p_transaction_id,
      p_credits,
      p_trial_expires_at
    );
  END IF;

  IF p_source IN ('subscription', 'subscription_annual') THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM credit_purchases
      WHERE apple_original_transaction_id = p_original_transaction_id
        AND source IN ('subscription', 'subscription_annual')
        AND amount_usd > 0
        AND status = 'completed'
    ) INTO v_first_paid_subscription;
  END IF;

  INSERT INTO credit_purchases (
    user_id,
    stripe_session_id,
    credits,
    amount_usd,
    status,
    source,
    provider,
    apple_transaction_id,
    apple_original_transaction_id,
    apple_product_id,
    apple_environment
  ) VALUES (
    p_user_id,
    'apple_' || p_transaction_id,
    p_credits,
    p_amount_usd,
    'completed',
    p_source,
    'apple',
    p_transaction_id,
    p_original_transaction_id,
    p_product_id,
    p_environment
  ) RETURNING id INTO v_new_purchase_id;

  IF p_source IN ('subscription', 'subscription_annual') THEN
    UPDATE credit_balances
    SET balance = GREATEST(0, balance - trial_balance),
        trial_balance = 0,
        trial_expires_at = NULL,
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO credit_balances (
    user_id,
    balance,
    trial_balance,
    trial_expires_at,
    lifetime_purchased,
    lifetime_used,
    updated_at
  ) VALUES (
    p_user_id,
    p_credits,
    CASE WHEN p_source = 'trial' THEN p_credits ELSE 0 END,
    CASE WHEN p_source = 'trial' THEN p_trial_expires_at ELSE NULL END,
    CASE WHEN p_source = 'trial' THEN 0 ELSE p_credits END,
    0,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET balance = credit_balances.balance + EXCLUDED.balance,
      trial_balance = credit_balances.trial_balance + EXCLUDED.trial_balance,
      trial_expires_at = COALESCE(EXCLUDED.trial_expires_at, credit_balances.trial_expires_at),
      lifetime_purchased = credit_balances.lifetime_purchased + EXCLUDED.lifetime_purchased,
      updated_at = now()
  RETURNING balance INTO v_new_balance;

  RETURN jsonb_build_object(
    'granted', true,
    'processed', true,
    'credits', p_credits,
    'balance', v_new_balance,
    'purchase_id', v_new_purchase_id,
    'first_paid_subscription', v_first_paid_subscription,
    'reason', 'granted'
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION grant_apple_credits_and_record_purchase(
  uuid, integer, numeric, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION grant_apple_credits_and_record_purchase(
  uuid, integer, numeric, text, text, text, text, text, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION expire_apple_trial_credits(
  p_user_id uuid
) RETURNS integer AS $$
DECLARE
  v_balance integer;
BEGIN
  UPDATE credit_balances
  SET balance = GREATEST(0, balance - trial_balance),
      trial_balance = 0,
      trial_expires_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND trial_expires_at IS NOT NULL
    AND trial_expires_at <= now()
  RETURNING balance INTO v_balance;

  IF v_balance IS NULL THEN
    SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
  END IF;

  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION expire_apple_trial_credits(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_apple_trial_credits(uuid)
  TO service_role;

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
  p_cache_write_tokens integer DEFAULT NULL
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
    trial_credits_charged
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
    v_trial_charged
  );

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION refund_credits_and_log(
  p_user_id uuid,
  p_amount integer,
  p_tool_name text,
  p_source text DEFAULT 'app'
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

  FOR v_usage IN
    SELECT id, credits_charged, trial_credits_charged, refunded_credits
    FROM usage_logs
    WHERE user_id = p_user_id
      AND tool_name = p_tool_name
      AND credits_charged > 0
      AND refunded_credits < credits_charged
    ORDER BY created_at DESC, id DESC
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
    trial_credits_charged
  ) VALUES (
    p_user_id,
    'refund:' || p_tool_name,
    -p_amount,
    p_source,
    -v_trial_refund
  );

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION refund_credits_and_log(uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refund_credits_and_log(uuid, integer, text, text)
  TO service_role;

DROP FUNCTION IF EXISTS fail_video_snapshot_and_refund(uuid, text);

CREATE OR REPLACE FUNCTION fail_video_snapshot_and_refund(
  p_snapshot_id text,
  p_error text DEFAULT NULL
) RETURNS TABLE (
  processed boolean,
  refunded_credits integer,
  remaining_balance integer
) AS $$
DECLARE
  v_snapshot record;
  v_meta jsonb;
  v_credits integer;
  v_user_id uuid;
  v_remaining integer;
BEGIN
  SELECT id, project_id, video_meta
  INTO v_snapshot
  FROM snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_snapshot.video_meta->>'status', '') <> 'processing' THEN
    RETURN QUERY SELECT false, 0, NULL::integer;
    RETURN;
  END IF;

  v_meta := COALESCE(v_snapshot.video_meta, '{}'::jsonb);
  v_credits := GREATEST(0, COALESCE((v_meta->>'creditsCharged')::integer, 0));
  v_meta := v_meta || jsonb_build_object('status', 'failed', 'refunded', v_credits > 0);

  IF p_error IS NOT NULL AND length(p_error) > 0 THEN
    v_meta := v_meta || jsonb_build_object('error', p_error);
  END IF;

  UPDATE snapshots SET video_meta = v_meta WHERE id = p_snapshot_id;

  IF v_credits > 0 THEN
    SELECT user_id INTO v_user_id FROM projects WHERE id = v_snapshot.project_id;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'video snapshot project has no owner' USING ERRCODE = 'P0002';
    END IF;
    SELECT refund_credits_and_log(v_user_id, v_credits, 'create_video', 'app')
      INTO v_remaining;
  END IF;

  RETURN QUERY SELECT true, v_credits, v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION fail_video_snapshot_and_refund(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_video_snapshot_and_refund(text, text)
  TO service_role;
