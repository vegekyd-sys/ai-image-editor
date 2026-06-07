-- Private model-state transcript for cross-turn tool reuse.
-- This is intentionally separate from public/user-visible messages.
CREATE TABLE IF NOT EXISTS agent_tool_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  step integer NOT NULL DEFAULT 0,
  seq integer NOT NULL DEFAULT 0,
  tool_call_id text NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb NOT NULL DEFAULT '{"type":"json","value":{}}',
  omitted jsonb NOT NULL DEFAULT '[]',
  input_chars integer NOT NULL DEFAULT 0,
  output_chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_history_project_created
  ON agent_tool_history(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_tool_history_run_step_seq
  ON agent_tool_history(run_id, step, seq);

ALTER TABLE agent_tool_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own agent tool history"
  ON agent_tool_history FOR SELECT
  USING (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users insert own agent tool history"
  ON agent_tool_history FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users delete own agent tool history"
  ON agent_tool_history FOR DELETE
  USING (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
