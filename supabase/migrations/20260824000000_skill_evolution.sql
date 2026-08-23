-- Skill Evolution v1: immutable Skill fingerprints, per-run usage, evaluations,
-- and human-gated improvement proposals. No Skill content or user prompt is
-- copied into these tables; Git + SHA-256 remain the source of truth.

CREATE TABLE IF NOT EXISTS public.skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key text NOT NULL CHECK (skill_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  source_path text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_length integer NOT NULL CHECK (content_length >= 0),
  git_sha text,
  release_channel text NOT NULL DEFAULT 'observed'
    CHECK (release_channel IN ('observed', 'candidate', 'canary', 'production', 'retired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_key, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_key_observed
  ON public.skill_versions(skill_key, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS public.skill_run_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_version_id uuid NOT NULL REFERENCES public.skill_versions(id) ON DELETE RESTRICT,
  skill_key text NOT NULL,
  activation_sources text[] NOT NULL DEFAULT ARRAY[]::text[],
  read_count integer NOT NULL DEFAULT 1 CHECK (read_count > 0),
  first_used_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, skill_version_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_run_usages_key_used
  ON public.skill_run_usages(skill_key, first_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_run_usages_project
  ON public.skill_run_usages(project_id, first_used_at DESC);

CREATE TABLE IF NOT EXISTS public.skill_run_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_id uuid NOT NULL REFERENCES public.skill_run_usages(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  skill_key text NOT NULL,
  evaluator_version text NOT NULL,
  evaluator_kind text NOT NULL CHECK (evaluator_kind IN ('deterministic', 'model', 'human')),
  evaluator_actor text NOT NULL DEFAULT 'system',
  outcome text NOT NULL CHECK (outcome IN ('pass', 'fail', 'inconclusive')),
  overall_score numeric(5,2) CHECK (overall_score BETWEEN 0 AND 100),
  score_coverage numeric(5,4) NOT NULL DEFAULT 0 CHECK (score_coverage BETWEEN 0 AND 1),
  hard_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usage_id, evaluator_version, evaluator_kind, evaluator_actor)
);

CREATE INDEX IF NOT EXISTS idx_skill_run_evaluations_key_created
  ON public.skill_run_evaluations(skill_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.skill_improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key text NOT NULL,
  base_version_id uuid NOT NULL REFERENCES public.skill_versions(id) ON DELETE RESTRICT,
  candidate_version_id uuid REFERENCES public.skill_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'replay_ready', 'canary', 'rejected', 'promoted', 'rolled_back')),
  hypothesis text NOT NULL,
  evidence_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  replay_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  canary_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_skill_improvement_proposals_key_status
  ON public.skill_improvement_proposals(skill_key, status, created_at DESC);

ALTER TABLE public.skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_run_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_run_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_improvement_proposals ENABLE ROW LEVEL SECURITY;

-- These are internal evaluation tables. Service-role-backed admin/jobs access
-- them directly. Authenticated users can only register usage for their own run
-- through the checked function below.

CREATE OR REPLACE FUNCTION public.record_skill_run_usage(
  p_run_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_skill_key text,
  p_source_path text,
  p_content_sha256 text,
  p_content_length integer,
  p_activation_source text DEFAULT 'read_file',
  p_git_sha text DEFAULT NULL,
  p_observed_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (version_id uuid, usage_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id uuid;
  v_usage_id uuid;
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Skill usage user does not match authenticated user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_runs run
    WHERE run.id = p_run_id
      AND run.project_id = p_project_id
      AND run.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Skill usage does not match Agent Run ownership';
  END IF;

  IF p_activation_source NOT IN ('read_file', 'skill_launch', 'system_prompt', 'backfill') THEN
    RAISE EXCEPTION 'Unsupported Skill activation source';
  END IF;

  INSERT INTO public.skill_versions (
    skill_key, source_path, content_sha256, content_length, git_sha,
    metadata, first_observed_at, last_observed_at
  ) VALUES (
    p_skill_key, p_source_path, p_content_sha256, p_content_length, p_git_sha,
    COALESCE(p_metadata, '{}'::jsonb), p_observed_at, p_observed_at
  )
  ON CONFLICT (skill_key, content_sha256) DO UPDATE
  SET source_path = EXCLUDED.source_path,
      content_length = EXCLUDED.content_length,
      git_sha = COALESCE(public.skill_versions.git_sha, EXCLUDED.git_sha),
      metadata = public.skill_versions.metadata || EXCLUDED.metadata,
      first_observed_at = LEAST(public.skill_versions.first_observed_at, EXCLUDED.first_observed_at),
      last_observed_at = GREATEST(public.skill_versions.last_observed_at, EXCLUDED.last_observed_at)
  RETURNING id INTO v_version_id;

  INSERT INTO public.skill_run_usages (
    run_id, project_id, user_id, skill_version_id, skill_key,
    activation_sources, first_used_at, last_used_at, metadata
  ) VALUES (
    p_run_id, p_project_id, p_user_id, v_version_id, p_skill_key,
    ARRAY[p_activation_source], p_observed_at, p_observed_at, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (run_id, skill_version_id) DO UPDATE
  SET read_count = public.skill_run_usages.read_count + 1,
      activation_sources = ARRAY(
        SELECT DISTINCT source
        FROM unnest(public.skill_run_usages.activation_sources || EXCLUDED.activation_sources) AS source
      ),
      first_used_at = LEAST(public.skill_run_usages.first_used_at, EXCLUDED.first_used_at),
      last_used_at = GREATEST(public.skill_run_usages.last_used_at, EXCLUDED.last_used_at),
      metadata = public.skill_run_usages.metadata || EXCLUDED.metadata
  RETURNING id INTO v_usage_id;

  RETURN QUERY SELECT v_version_id, v_usage_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_skill_run_usage(
  uuid, uuid, uuid, text, text, text, integer, text, text, timestamptz, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_skill_run_usage(
  uuid, uuid, uuid, text, text, text, integer, text, text, timestamptz, jsonb
) TO authenticated, service_role;

COMMENT ON TABLE public.skill_versions IS
  'Immutable hashes for Skill source observed by a real Agent Run; content stays in Git.';
COMMENT ON TABLE public.skill_run_usages IS
  'Joins an Agent Run to the exact Skill version it read or launched.';
COMMENT ON TABLE public.skill_run_evaluations IS
  'Versioned deterministic, model, and human evaluation results for one Skill usage.';
COMMENT ON TABLE public.skill_improvement_proposals IS
  'Human-gated candidate lifecycle; proposals never auto-merge or auto-deploy.';
