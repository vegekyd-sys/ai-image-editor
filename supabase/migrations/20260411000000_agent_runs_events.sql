-- agent_runs: track each agent invocation
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'running',
  prompt text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  metadata jsonb
);

-- agent_events: every SSE event persisted for replay/reconnect
CREATE TABLE agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_agent_events_run_seq ON agent_events(run_id, seq);
CREATE INDEX idx_agent_runs_project ON agent_runs(project_id, started_at DESC);

-- RLS for agent_runs
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own runs"
  ON agent_runs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own runs"
  ON agent_runs FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own runs"
  ON agent_runs FOR UPDATE
  USING (user_id = auth.uid());

-- RLS for agent_events
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own events"
  ON agent_events FOR SELECT
  USING (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));

CREATE POLICY "Users insert own events"
  ON agent_events FOR INSERT
  WITH CHECK (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_runs;
