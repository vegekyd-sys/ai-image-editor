-- Add project_id to agent_events for direct project association
-- User events (image_upload, tip_committed, etc.) use this instead of run_id
ALTER TABLE agent_events ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

-- Make run_id nullable (user events don't have a run)
ALTER TABLE agent_events ALTER COLUMN run_id DROP NOT NULL;

-- Index for querying all events for a project (Replay)
CREATE INDEX idx_agent_events_project_created ON agent_events(project_id, created_at);

-- Backfill existing events with project_id from their run
UPDATE agent_events SET project_id = (
  SELECT project_id FROM agent_runs WHERE agent_runs.id = agent_events.run_id
) WHERE project_id IS NULL AND run_id IS NOT NULL;

-- RLS: allow users to insert events for their own projects
CREATE POLICY "Users insert own project events" ON agent_events FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- RLS: allow users to read events for their own projects
CREATE POLICY "Users read own project events" ON agent_events FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
