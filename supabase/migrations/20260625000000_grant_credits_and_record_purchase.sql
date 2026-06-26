-- Atomic credit grants for Stripe payments. This prevents half-success cases
-- where balance changes but credit_purchases does not record the invoice.

CREATE OR REPLACE FUNCTION grant_credits_and_record_purchase(
  p_user_id UUID,
  p_credits INT,
  p_amount_usd NUMERIC,
  p_stripe_session_id TEXT,
  p_stripe_invoice_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'topup'
) RETURNS JSONB AS $$
DECLARE
  v_existing_id UUID;
  v_new_balance INT;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'credits must be positive';
  END IF;

  -- Serialize by Stripe invoice when present, otherwise by checkout/session id.
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(p_stripe_invoice_id, p_stripe_session_id)));

  IF p_stripe_invoice_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM credit_purchases
    WHERE stripe_invoice_id = p_stripe_invoice_id
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
    FROM credit_purchases
    WHERE stripe_session_id = p_stripe_session_id
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    SELECT balance INTO v_new_balance
    FROM credit_balances
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'granted', false,
      'balance', COALESCE(v_new_balance, 0),
      'purchase_id', v_existing_id
    );
  END IF;

  INSERT INTO credit_purchases (
    user_id,
    stripe_session_id,
    stripe_invoice_id,
    credits,
    amount_usd,
    status,
    source
  ) VALUES (
    p_user_id,
    p_stripe_session_id,
    p_stripe_invoice_id,
    p_credits,
    p_amount_usd,
    'completed',
    p_source
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
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET balance = credit_balances.balance + EXCLUDED.balance,
      lifetime_purchased = credit_balances.lifetime_purchased + EXCLUDED.lifetime_purchased,
      updated_at = NOW()
  RETURNING balance INTO v_new_balance;

  RETURN jsonb_build_object(
    'granted', true,
    'balance', v_new_balance,
    'purchase_id', NULL
  );
END;
$$ LANGUAGE plpgsql;
