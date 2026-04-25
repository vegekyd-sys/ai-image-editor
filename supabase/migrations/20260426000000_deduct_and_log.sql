-- Atomic deduct + log: ensures balance deduction and usage_logs insert
-- happen in the same transaction. Prevents:
-- 1. Lost usage_logs (fire-and-forget kills process after deduct but before log)
-- 2. Double-charge (old fallback path could deduct twice on RPC timeout)

CREATE OR REPLACE FUNCTION deduct_and_log(
  p_user_id UUID,
  p_amount INT,
  p_tool_name TEXT,
  p_model_used TEXT DEFAULT NULL,
  p_input_tokens INT DEFAULT NULL,
  p_output_tokens INT DEFAULT NULL,
  p_duration_ms INT DEFAULT NULL,
  p_source TEXT DEFAULT 'app',
  p_api_key_id UUID DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_remaining INT;
BEGIN
  -- Atomic balance deduction
  UPDATE credit_balances
  SET balance = GREATEST(0, balance - p_amount),
      lifetime_used = lifetime_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_remaining;

  -- Usage log in same transaction
  INSERT INTO usage_logs (user_id, api_key_id, tool_name, model_used,
    credits_charged, input_tokens, output_tokens, duration_ms, source)
  VALUES (p_user_id, p_api_key_id, p_tool_name, p_model_used,
    p_amount, p_input_tokens, p_output_tokens, p_duration_ms, p_source);

  RETURN COALESCE(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;
