-- One snapshot/round trip for current source + installed revision. Only the
-- already-authenticated server calls this service-role-only invoker function.
CREATE OR REPLACE FUNCTION public.resolve_marketplace_skill(p_user_id uuid, p_marketplace_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'source', jsonb_build_object('id', h.id, 'skill_path', h.skill_path, 'updated_at', h.updated_at, 'labels', h.labels),
    'installed', (SELECT jsonb_build_object('path', w.path, 'marketplace_source', w.marketplace_source)
      FROM public.workspace_files w WHERE w.user_id = p_user_id AND w.marketplace_id = p_marketplace_id
      AND w.path LIKE 'skills/%/SKILL.md' ORDER BY w.path LIMIT 1)
  ) FROM public.home_skills h WHERE h.id = p_marketplace_id AND h.is_active AND h.skill_path IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.resolve_marketplace_skill(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_marketplace_skill(uuid, uuid) TO service_role;
