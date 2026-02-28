CREATE TABLE project_animations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  piapi_task_id text,
  status text NOT NULL DEFAULT 'processing',
  video_url text,
  prompt text,
  snapshot_urls text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_animations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own animations"
  ON project_animations FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
