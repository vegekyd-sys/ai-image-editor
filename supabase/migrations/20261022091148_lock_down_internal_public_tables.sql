-- Apply only after the health-check cron uses the service-role client.
-- All five tables are internal: access is through authorized server routes.
-- Snapshot: 2026-10-22, project sdyrtztrjgmmpnirswxt.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

LOCK TABLE public.agent_challenges, public.credit_pricing, public.health_alerts,
  public.subscriptions, public.token_rates IN ACCESS EXCLUSIVE MODE;

-- Stop on access-contract drift instead of overwriting another change.
DO $guard$
DECLARE
  target regclass;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role must retain BYPASSRLS';
  END IF;
  FOREACH target IN ARRAY ARRAY[
    'public.agent_challenges'::regclass, 'public.credit_pricing'::regclass,
    'public.health_alerts'::regclass, 'public.subscriptions'::regclass,
    'public.token_rates'::regclass
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = target) THEN
      RAISE EXCEPTION 'Unexpected existing policy on %; review before applying', target;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = target AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'Unexpected column grants on %; review before applying', target;
    END IF;
    IF NOT (has_table_privilege('service_role', target, 'SELECT')
      AND has_table_privilege('service_role', target, 'INSERT')
      AND has_table_privilege('service_role', target, 'UPDATE')
      AND has_table_privilege('service_role', target, 'DELETE')) THEN
      RAISE EXCEPTION 'Missing existing server privileges on %', target;
    END IF;
  END LOOP;
END
$guard$;

-- No browser/anonymous policies are needed for the verified server-only paths.
ALTER TABLE public.agent_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_rates ENABLE ROW LEVEL SECURITY;

-- RLS does not govern TRUNCATE; revoke table grants as well as enabling RLS.
REVOKE ALL PRIVILEGES ON TABLE
  public.agent_challenges, public.credit_pricing, public.health_alerts,
  public.subscriptions, public.token_rates
FROM PUBLIC, anon, authenticated;

-- Catch inherited privileges too. Any unexpected access aborts the transaction.
DO $verify$
DECLARE
  target regclass;
  role_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.agent_challenges'::regclass, 'public.credit_pricing'::regclass,
    'public.health_alerts'::regclass, 'public.subscriptions'::regclass,
    'public.token_rates'::regclass
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(role_name, target, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Unexpected remaining privilege for % on %', role_name, target;
      END IF;
    END LOOP;
  END LOOP;
END
$verify$;
COMMIT;
