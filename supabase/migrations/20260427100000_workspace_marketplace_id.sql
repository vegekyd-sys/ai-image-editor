ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS marketplace_id uuid;
CREATE INDEX IF NOT EXISTS idx_workspace_files_marketplace ON workspace_files (user_id, marketplace_id) WHERE marketplace_id IS NOT NULL;
