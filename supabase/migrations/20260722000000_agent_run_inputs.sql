-- Agent Run is the only schedulable/model-facing execution. Instructions that
-- arrive while it is active become inputs to that execution instead of
-- superseding it or creating a second owner for a Studio workflow invocation.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS input_version bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS agent_run_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  source text NOT NULL DEFAULT 'api' CHECK (source IN ('cli', 'cui', 'agent', 'api')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
  applied_attempt_id uuid REFERENCES agent_attempts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_run_inputs_pending
  ON agent_run_inputs(run_id, created_at)
  WHERE status = 'pending';

ALTER TABLE agent_run_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own Agent Run inputs"
  ON agent_run_inputs FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM agent_runs run
      WHERE run.id = agent_run_inputs.run_id
        AND run.project_id = agent_run_inputs.project_id
        AND run.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users insert own Agent Run inputs"
  ON agent_run_inputs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM agent_runs run
      WHERE run.id = agent_run_inputs.run_id
        AND run.project_id = agent_run_inputs.project_id
        AND run.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users update own Agent Run inputs"
  ON agent_run_inputs FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM agent_runs run
      WHERE run.id = agent_run_inputs.run_id
        AND run.project_id = agent_run_inputs.project_id
        AND run.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM agent_runs run
      WHERE run.id = agent_run_inputs.run_id
        AND run.project_id = agent_run_inputs.project_id
        AND run.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE agent_run_inputs TO authenticated;
GRANT ALL ON TABLE agent_run_inputs TO service_role;

CREATE OR REPLACE FUNCTION public.append_agent_run_input(
  p_run_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_content text,
  p_source text DEFAULT 'api'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_input_id uuid := gen_random_uuid();
BEGIN
  IF btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Agent Run input cannot be empty';
  END IF;

  UPDATE public.agent_runs
  SET input_version = input_version + 1,
      next_attempt_at = COALESCE(next_attempt_at, now())
  WHERE id = p_run_id
    AND project_id = p_project_id
    AND user_id = p_user_id
    AND status = 'running'
    AND COALESCE((execution_policy->>'durable')::boolean, false) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent Run is not active and appendable';
  END IF;

  INSERT INTO public.agent_run_inputs (id, run_id, project_id, user_id, content, source)
  VALUES (v_input_id, p_run_id, p_project_id, p_user_id, p_content, p_source);

  RETURN v_input_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_agent_run_input(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_agent_run_input(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_agent_run_input(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;
