CREATE INDEX IF NOT EXISTS idx_remotion_export_jobs_fingerprint
  ON remotion_export_jobs(project_id, (metadata->>'fingerprint'), output_type, created_at DESC)
  WHERE metadata ? 'fingerprint';
