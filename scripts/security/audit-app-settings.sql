-- Read-only before/after audit; values are fingerprinted, never returned.
BEGIN READ ONLY;
SELECT json_build_object(
  'table', (SELECT row_to_json(t) FROM (
    SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls,
      pg_get_userbyid(relowner) AS owner, relacl
    FROM pg_class WHERE oid = 'public.app_settings'::regclass
  ) t),
  'columns', (SELECT json_agg(t) FROM (
    SELECT attname, attacl FROM pg_attribute
    WHERE attrelid = 'public.app_settings'::regclass AND attnum > 0 AND NOT attisdropped
  ) t),
  'roles', (SELECT json_agg(t) FROM (
    SELECT role_name, permission,
      has_table_privilege(role_name, 'public.app_settings', permission) AS allowed
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(permission)
  ) t),
  'policies', (SELECT json_agg(t) FROM (
    SELECT policyname, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_settings'
  ) t),
  'settings', (SELECT json_agg(t) FROM (
    SELECT key, md5(value) AS value_hash, updated_at FROM public.app_settings ORDER BY key
  ) t),
  'functions', (SELECT json_agg(t) FROM (
    SELECT n.nspname, p.proname, p.prosecdef, p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f' AND p.prosrc ILIKE '%app_settings%'
  ) t),
  'views', (SELECT json_agg(t) FROM (
    SELECT schemaname, viewname FROM pg_views WHERE definition ILIKE '%app_settings%'
  ) t),
  'triggers', (SELECT json_agg(t) FROM (
    SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
    WHERE tgrelid = 'public.app_settings'::regclass AND NOT tgisinternal
  ) t)
);
COMMIT;
