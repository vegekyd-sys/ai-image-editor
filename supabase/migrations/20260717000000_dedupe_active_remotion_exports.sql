CREATE UNIQUE INDEX IF NOT EXISTS idx_remotion_export_jobs_active_fingerprint
  ON remotion_export_jobs(
    project_id,
    user_id,
    output_type,
    (metadata->>'fingerprint')
  )
  WHERE status IN ('queued', 'rendering')
    AND metadata ? 'fingerprint';
