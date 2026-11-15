BEGIN;
SET LOCAL lock_timeout = '100ms';
SET LOCAL statement_timeout = '5s';

-- Same policy expressions and roles, with statement-stable JWT reads evaluated
-- once instead of for every row. No SECURITY DEFINER or access-policy widening.
DO $$
DECLARE p record; new_qual text; new_check text;
BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('projects', 'snapshots', 'messages', 'workspace_files', 'agent_events', 'agent_runs')
  LOOP
    new_qual := p.qual;
    IF position('SELECT auth.uid()' in coalesce(new_qual, '')) = 0 THEN new_qual := replace(new_qual, 'auth.uid()', '(SELECT auth.uid())'); END IF;
    IF position('SELECT auth.role()' in coalesce(new_qual, '')) = 0 THEN new_qual := replace(new_qual, 'auth.role()', '(SELECT auth.role())'); END IF;
    new_check := p.with_check;
    IF position('SELECT auth.uid()' in coalesce(new_check, '')) = 0 THEN new_check := replace(new_check, 'auth.uid()', '(SELECT auth.uid())'); END IF;
    IF position('SELECT auth.role()' in coalesce(new_check, '')) = 0 THEN new_check := replace(new_check, 'auth.role()', '(SELECT auth.role())'); END IF;
    IF new_qual IS DISTINCT FROM p.qual OR new_check IS DISTINCT FROM p.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
        CASE WHEN new_qual IS NULL THEN '' ELSE ' USING (' || new_qual || ')' END,
        CASE WHEN new_check IS NULL THEN '' ELSE ' WITH CHECK (' || new_check || ')' END);
    END IF;
  END LOOP;
END $$;

-- Fixed predicates let the partial index work with generic prepared plans too.
-- The invoker's existing workspace RLS still enforces own/global visibility.
CREATE OR REPLACE FUNCTION public.list_workspace_skill_entries(p_user_id uuid, p_manifest boolean DEFAULT false)
RETURNS TABLE(path text, content_type text, size_bytes bigint, storage_url text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT w.path, w.content_type, w.size_bytes::bigint, w.storage_url, w.updated_at
  FROM public.workspace_files AS w
  WHERE (w.user_id = p_user_id OR w.user_id IS NULL)
    AND (w.path LIKE 'skills/%/SKILL.md' OR w.path LIKE 'skills/%/.makaron-skill-index.json')
    AND w.path LIKE CASE WHEN p_manifest THEN 'skills/%/.makaron-skill-index.json' ELSE 'skills/%/SKILL.md' END
  ORDER BY w.path;
$$;
REVOKE ALL ON FUNCTION public.list_workspace_skill_entries(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_workspace_skill_entries(uuid, boolean) TO authenticated, service_role;
COMMIT;
