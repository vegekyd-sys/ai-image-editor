ALTER TABLE agent_context_snapshots
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

UPDATE agent_context_snapshots snapshot
SET project_id = run.project_id
FROM agent_runs run
WHERE snapshot.run_id = run.id
  AND snapshot.project_id IS NULL;

ALTER TABLE agent_context_snapshots
  ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_context_snapshots_project_created
  ON agent_context_snapshots(project_id, created_at DESC);

