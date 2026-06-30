CREATE TABLE IF NOT EXISTS remotion_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id text REFERENCES snapshots(id) ON DELETE SET NULL,
  design_path text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'completed', 'failed')),
  output_type text NOT NULL DEFAULT 'video' CHECK (output_type IN ('video', 'image')),
  publish boolean NOT NULL DEFAULT false,
  progress numeric,
  workspace_path text,
  storage_url text,
  content_type text,
  duration_seconds numeric,
  render_seconds numeric,
  realtime_ratio numeric,
  width integer,
  height integer,
  fps integer,
  error text,
  worker_id text,
  heartbeat_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_project_created
  ON remotion_export_jobs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_user_created
  ON remotion_export_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_status_created
  ON remotion_export_jobs(status, created_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_fingerprint
  ON remotion_export_jobs(project_id, (metadata->>'fingerprint'), output_type, created_at DESC)
  WHERE metadata ? 'fingerprint';

ALTER TABLE remotion_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own remotion export jobs"
  ON remotion_export_jobs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own remotion export jobs"
  ON remotion_export_jobs FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users update own remotion export jobs"
  ON remotion_export_jobs FOR UPDATE
  USING (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
