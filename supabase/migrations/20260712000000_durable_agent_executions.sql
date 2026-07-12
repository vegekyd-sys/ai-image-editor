-- Durable, restartable Agent execution state.
-- agent_runs remains the public execution id used by CUI and makaron-cli.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS current_work_unit text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_input_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_output_tokens bigint NOT NULL DEFAULT 0;

UPDATE agent_runs
SET objective = COALESCE(objective, prompt)
WHERE objective IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_due_execution
  ON agent_runs(next_attempt_at, lease_expires_at)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS agent_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  attempt_no integer NOT NULL,
  work_unit_key text NOT NULL DEFAULT 'agent',
  status text NOT NULL DEFAULT 'running',
  lease_token uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  input_token_estimate integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  terminal_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(run_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_agent_attempts_run_started
  ON agent_attempts(run_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES agent_attempts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  version integer NOT NULL DEFAULT 1,
  kind text NOT NULL DEFAULT 'handoff',
  source_event_seq integer,
  token_estimate integer NOT NULL DEFAULT 0,
  content jsonb NOT NULL,
  provider_compaction jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_context_snapshots_run_created
  ON agent_context_snapshots(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES agent_attempts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  work_unit_key text NOT NULL,
  operation_key text NOT NULL,
  tool_name text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  result jsonb,
  external_task_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_operations_run_status
  ON agent_operations(run_id, status, updated_at DESC);

ALTER TABLE agent_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agent attempts"
  ON agent_attempts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage own agent context snapshots"
  ON agent_context_snapshots FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage own agent operations"
  ON agent_operations FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION claim_agent_execution(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 480
)
RETURNS TABLE (
  run_id uuid,
  lease_token uuid,
  attempt_no integer,
  user_id uuid,
  project_id uuid,
  objective text,
  acceptance_criteria jsonb,
  execution_policy jsonb,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  UPDATE agent_runs r
  SET lease_token = v_token,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(60, LEAST(p_lease_seconds, 900))),
      next_attempt_at = NULL,
      attempt_count = r.attempt_count + 1
  WHERE r.id = p_run_id
    AND r.status = 'running'
    AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
  RETURNING r.id, v_token, r.attempt_count, r.user_id, r.project_id,
            COALESCE(r.objective, r.prompt), r.acceptance_criteria,
            r.execution_policy, r.metadata;
END;
$$;

CREATE OR REPLACE FUNCTION claim_agent_operation(
  p_run_id uuid,
  p_attempt_id uuid,
  p_user_id uuid,
  p_work_unit_key text,
  p_operation_key text,
  p_tool_name text
)
RETURNS TABLE (
  claimed boolean,
  operation_id uuid,
  operation_status text,
  operation_result jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row agent_operations%ROWTYPE;
BEGIN
  INSERT INTO agent_operations (
    run_id, attempt_id, user_id, work_unit_key, operation_key, tool_name, status
  ) VALUES (
    p_run_id, p_attempt_id, p_user_id, p_work_unit_key, p_operation_key, p_tool_name, 'running'
  )
  ON CONFLICT (run_id, operation_key) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_row.id, v_row.status, v_row.result;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM agent_operations
  WHERE run_id = p_run_id AND operation_key = p_operation_key;

  IF v_row.status = 'failed' THEN
    UPDATE agent_operations
    SET status = 'running', attempt_id = p_attempt_id, started_at = now(),
        completed_at = NULL, updated_at = now(), result = NULL
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN QUERY SELECT true, v_row.id, v_row.status, v_row.result;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, v_row.id, v_row.status, v_row.result;
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE agent_attempts;

