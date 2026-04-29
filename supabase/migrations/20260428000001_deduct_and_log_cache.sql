-- Extend deduct_and_log RPC with cache token tracking (optional params for backward compat).
-- DROP the old 9-param signature first — otherwise CREATE OR REPLACE creates an overload
-- (functions are identified by arg type list, not default values), and PostgREST may
-- fail with "function is not unique" when old code calls with 9 named params.

DROP FUNCTION IF EXISTS deduct_and_log(UUID, INT, TEXT, TEXT, INT, INT, INT, TEXT, UUID);

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
BEGIN
  UPDATE credit_balances
  SET balance = GREATEST(0, balance - p_amount),
      lifetime_used = lifetime_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_remaining;

  INSERT INTO usage_logs (user_id, api_key_id, tool_name, model_used,
    credits_charged, input_tokens, output_tokens, duration_ms, source,
    cache_read_tokens, cache_write_tokens)
  VALUES (p_user_id, p_api_key_id, p_tool_name, p_model_used,
    p_amount, p_input_tokens, p_output_tokens, p_duration_ms, p_source,
    p_cache_read_tokens, p_cache_write_tokens);

  RETURN COALESCE(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;
