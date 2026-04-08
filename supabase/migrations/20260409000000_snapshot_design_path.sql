-- Add design_path column to snapshots table
-- Stores workspace path to persisted design JSON (code + animation + props)
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS design_path TEXT;
