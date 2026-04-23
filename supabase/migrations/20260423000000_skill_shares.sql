-- Skill share links for private sharing
CREATE TABLE skill_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  sharer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE skill_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shares"
  ON skill_shares FOR SELECT USING (sharer_id = auth.uid());

CREATE POLICY "Users can create shares"
  ON skill_shares FOR INSERT WITH CHECK (sharer_id = auth.uid());

CREATE POLICY "Users can delete own shares"
  ON skill_shares FOR DELETE USING (sharer_id = auth.uid());

CREATE INDEX idx_skill_shares_code ON skill_shares(code);
