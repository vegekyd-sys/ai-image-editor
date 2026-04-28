ALTER TABLE home_skills ADD COLUMN IF NOT EXISTS before_images jsonb NOT NULL DEFAULT '[]';
