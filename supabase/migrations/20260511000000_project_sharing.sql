-- Project sharing: add is_public column (default true = public)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

-- Public projects are viewable by anyone (including anon/unauthenticated)
CREATE POLICY "Public projects viewable by anyone"
  ON projects FOR SELECT USING (is_public = true);

-- Public project related data viewable by anyone
CREATE POLICY "Public project snapshots viewable"
  ON snapshots FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE is_public = true));

CREATE POLICY "Public project messages viewable"
  ON messages FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE is_public = true));

CREATE POLICY "Public project animations viewable"
  ON project_animations FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE is_public = true));

CREATE POLICY "Public project music viewable"
  ON project_music FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE is_public = true));
