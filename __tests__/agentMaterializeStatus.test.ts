import { describe, expect, it, vi } from 'vitest';
import { materializeStatus, refreshMaterializeStatus } from '@/lib/agent-materialize-status';
import { wrapDurableIdempotentTools } from '@/lib/agent-tool-guards';
import type { RemotionExportJob } from '@/lib/remotion-export';

const job: RemotionExportJob = { id: 'export-1', project_id: 'p1', user_id: 'u1', output_type: 'video', publish: true, status: 'completed', storage_url: 'https://cdn.example/finished.mp4', completed_at: '2026-10-17T13:30:00Z' };
const cached = { success: true, jobId: job.id, status: 'queued', queued: true, publishSnapshotId: 'original-snapshot', studioRunPending: true };
const owner = { userId: 'u1', projectId: 'p1' };
const lookup = vi.hoisted(() => vi.fn());
vi.mock('@/lib/remotion-export', () => ({ getRemotionExportJob: lookup, resolveRemotionExportDownloadUrl: async (value: RemotionExportJob) => value.storage_url }));

describe('materialize export status replay', () => {
  it('observes render completion without rerunning or republishing the tool', async () => {
    lookup.mockResolvedValue(job);
    const execute = vi.fn();
    const tools = wrapDurableIdempotentTools({ materialize_media: { execute } }, {
      ...owner,
      execution: { runId: 'r1', attemptId: 'a1', inputEpoch: 1 },
      supabase: { rpc: vi.fn(async () => ({ data: [{ claimed: false, operation_status: 'completed', operation_result: cached }] })) },
    } as never);
    expect(await tools.materialize_media.execute({ design_path: 'p1/draft.json' })).toMatchObject({
      success: true, reused: true, queued: false, status: 'completed', url: job.storage_url, publishSnapshotId: 'original-snapshot', statusVerified: true, studioRunPending: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith(job.id);
  });

  it('reports current rendering progress instead of replaying the queue state', async () => {
    const result = await refreshMaterializeStatus(cached, owner, async () => ({ ...job, status: 'rendering', progress: 0.7, storage_url: null }));
    expect(result).toMatchObject({ status: 'rendering', progress: 0.7, queued: true });
    expect(result).not.toHaveProperty('url');
  });

  it('surfaces an export failure after an initially successful queue submission', async () => {
    expect(await refreshMaterializeStatus(cached, owner, async () => ({ ...job, status: 'failed', storage_url: null, error: 'Source unavailable' }))).toMatchObject({ success: false, status: 'failed', queued: false, error: 'Source unavailable' });
  });

  it.each([null, { ...job, user_id: 'other' }, { ...job, project_id: 'other' }])('does not expose an unverified job', async (value) => {
    const result = await refreshMaterializeStatus(cached, owner, async () => value);
    expect(result).toMatchObject({ success: false, status: 'unknown' });
    expect(result).not.toHaveProperty('url');
  });

  it('does not claim queue status when the read fails', async () => {
    expect(await refreshMaterializeStatus(cached, owner, async () => { throw new Error('DB unavailable'); })).toMatchObject({ success: false, status: 'unknown' });
  });

  it('returns the completed file from the initial tool response too', () => {
    expect(materializeStatus(job)).toMatchObject({ success: true, queued: false, status: 'completed', url: job.storage_url });
    expect(materializeStatus(job).message).not.toContain('processing');
  });

  it('clears old file claims when a refreshed job is not ready', async () => {
    const result = await refreshMaterializeStatus({ ...cached, url: job.storage_url, completedAt: job.completed_at }, owner, async () => ({ ...job, status: 'rendering', storage_url: null }));
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('completedAt');
  });

  it('does not call a completed job without a file a queued success', () => {
    expect(materializeStatus({ ...job, storage_url: null })).toMatchObject({ success: false, queued: false, status: 'completed' });
  });
});
