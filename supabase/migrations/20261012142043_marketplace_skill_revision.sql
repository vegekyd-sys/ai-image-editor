ALTER TABLE public.workspace_files ADD COLUMN IF NOT EXISTS marketplace_source text;

-- Called only by the authenticated server's service client. Existing RLS is
-- unchanged; no SECURITY DEFINER and no anonymous/user EXECUTE privilege.
CREATE OR REPLACE FUNCTION public.commit_marketplace_skill(
  p_user_id uuid, p_marketplace_id uuid, p_skill_path text,
  p_source_updated_at timestamptz, p_source text, p_name text, p_files jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  published public.home_skills%ROWTYPE;
  installed public.workspace_files%ROWTYPE;
  root text := 'skills/' || p_name || '/';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('marketplace-install:' || p_user_id::text, 0));
  SELECT * INTO published FROM public.home_skills WHERE id = p_marketplace_id FOR SHARE;
  IF NOT FOUND OR NOT published.is_active OR published.skill_path IS DISTINCT FROM p_skill_path
    OR published.updated_at IS DISTINCT FROM p_source_updated_at THEN
    RETURN jsonb_build_object('retry', true);
  END IF;
  SELECT * INTO installed FROM public.workspace_files
    WHERE user_id = p_user_id AND marketplace_id = p_marketplace_id AND path LIKE 'skills/%/SKILL.md'
    ORDER BY path LIMIT 1;
  IF FOUND AND installed.marketplace_source = p_source THEN
    RETURN jsonb_build_object('alreadyInstalled', true, 'skillName', split_part(installed.path, '/', 2));
  END IF;
  IF installed.path IS NOT NULL AND installed.path <> root || 'SKILL.md' THEN
    RETURN jsonb_build_object('retry', true);
  END IF;
  IF p_name !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' OR jsonb_typeof(p_files) <> 'array'
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_files) f WHERE f->>'path' = root || 'SKILL.md')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_files) f WHERE left(f->>'path', length(root)) <> root) THEN
    RAISE EXCEPTION 'Invalid Skill publication';
  END IF;
  -- Check every destination, including assets/sidecar. Legacy unassociated
  -- files and custom Skills remain untouched, even if a name happens to match.
  IF EXISTS (SELECT 1 FROM public.workspace_files w JOIN jsonb_array_elements(p_files) f ON w.path = f->>'path'
    WHERE w.user_id = p_user_id AND w.marketplace_id IS DISTINCT FROM p_marketplace_id
      AND NOT (installed.path = root || 'SKILL.md' AND w.marketplace_id IS NULL AND w.path = root || '.makaron-skill-index.json')) THEN
    RAISE EXCEPTION 'Skill file belongs to a custom Skill or another template';
  END IF;
  DELETE FROM public.workspace_files WHERE user_id = p_user_id AND (marketplace_id = p_marketplace_id
    OR (installed.path = root || 'SKILL.md' AND marketplace_id IS NULL AND path = root || '.makaron-skill-index.json'));
  INSERT INTO public.workspace_files (user_id, path, storage_url, content_type, size_bytes, updated_at, marketplace_id, marketplace_source)
  SELECT p_user_id, f->>'path', f->>'storage_url', f->>'content_type', (f->>'size_bytes')::integer,
    (f->>'updated_at')::timestamptz, p_marketplace_id, p_source FROM jsonb_array_elements(p_files) f;
  RETURN jsonb_build_object('committed', true, 'skillName', p_name);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_marketplace_skill(uuid, uuid, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_marketplace_skill(uuid, uuid, text, timestamptz, text, text, jsonb) TO service_role;
