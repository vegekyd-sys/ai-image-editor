-- Runtime settings are server-only. Existing application callers use
-- getSupabaseAdmin(); browser and ordinary authenticated clients need no access.
-- Do not update setting values or revoke the service_role used by deployed code.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.app_settings FROM PUBLIC, anon, authenticated;
-- Table-level REVOKE does not remove separately granted column privileges.
REVOKE ALL PRIVILEGES (key, value, updated_at)
  ON TABLE public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_settings TO service_role;

COMMIT;
