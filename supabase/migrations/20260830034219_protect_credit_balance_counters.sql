-- Prevent a partial/read-failed upsert from replacing durable credit history.
-- Balance can legitimately decrease during usage or an agent-credit transfer,
-- but lifetime_purchased is append-only and must never move backwards.

CREATE OR REPLACE FUNCTION public.protect_credit_balance_counters()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'credit balance user_id is immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.lifetime_purchased < OLD.lifetime_purchased THEN
    RAISE EXCEPTION
      'lifetime_purchased cannot decrease (user_id=%, old=%, new=%)',
      OLD.user_id, OLD.lifetime_purchased, NEW.lifetime_purchased
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_credit_balance_counters
  ON public.credit_balances;

CREATE TRIGGER protect_credit_balance_counters
BEFORE UPDATE ON public.credit_balances
FOR EACH ROW
EXECUTE FUNCTION public.protect_credit_balance_counters();

COMMENT ON FUNCTION public.protect_credit_balance_counters() IS
  'Rejects identity changes and decreases to append-only lifetime_purchased.';
