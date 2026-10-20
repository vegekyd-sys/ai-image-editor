import type { RemotionExportJob } from './remotion-export';

type ExportStatus = Pick<RemotionExportJob,
  'id' | 'status' | 'storage_url' | 'workspace_path' | 'progress' | 'completed_at' | 'error'>;

export function materializeStatus(job: ExportStatus) {
  const ready = job.status === 'completed' && Boolean(job.storage_url);
  const missingFile = job.status === 'completed' && !ready;
  return {
    success: job.status !== 'failed' && !missingFile,
    queued: job.status === 'queued' || job.status === 'rendering',
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    ...(ready ? { url: job.storage_url, workspacePath: job.workspace_path, completedAt: job.completed_at } : {}),
    ...(job.status === 'failed' ? { error: job.error || 'MP4 export failed' } : {}),
    ...(missingFile ? { error: 'Export finished but its file location is unavailable. Keep the existing job for reconciliation.' } : {}),
    message: ready
      ? `MP4 export completed. Use the returned URL; do not queue another export. Job: ${job.id}`
      : missingFile
        ? `Export finished but its file location is unavailable. Do not create a duplicate. Job: ${job.id}`
        : job.status === 'failed'
        ? `MP4 export failed. Inspect the error before retrying. Job: ${job.id}`
        : `MP4 export is ${job.status}. The existing job will update automatically; do not submit a duplicate. Job: ${job.id}`,
  };
}

function unknownMaterializeStatus(jobId: string, error: string) {
  return { success: false, jobId, status: 'unknown', error };
}

/** Replay protects the render mutation; job status must still be read live. */
export async function refreshMaterializeStatus(
  cached: Record<string, unknown>,
  owner: { userId: string; projectId: string },
  lookup: (id: string) => Promise<RemotionExportJob | null>,
) {
  if (typeof cached.jobId !== 'string') return cached;
  try {
    const job = await lookup(cached.jobId);
    if (!job || job.user_id !== owner.userId || job.project_id !== owner.projectId) {
      return unknownMaterializeStatus(cached.jobId, 'Could not verify this export job in the current project. Do not create a duplicate.');
    }
    const { url: _url, workspacePath: _path, completedAt: _completed, ...identity } = cached;
    return {
      ...identity,
      ...materializeStatus(job),
      ...(typeof cached.studioRunPending === 'boolean' ? {
        studioRunPending: cached.studioRunPending && job.status !== 'completed' && job.status !== 'failed',
      } : {}),
      statusVerified: true,
    };
  } catch {
    return unknownMaterializeStatus(cached.jobId, 'Export status could not be refreshed. Keep the existing job and retry the status check; do not create a duplicate.');
  }
}
