-- Add metadata column to snapshots table for EXIF data (location, time)
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS metadata jsonb;
