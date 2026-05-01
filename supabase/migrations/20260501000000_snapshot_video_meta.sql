-- Video-in-Timeline: add video metadata to snapshots and timeline version to projects
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS video_meta jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS timeline_version integer NOT NULL DEFAULT 1;
