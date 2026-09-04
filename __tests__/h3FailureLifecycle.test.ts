// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ meta: {} as Record<string, unknown>, rpc: vi.fn(), after: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: state.after }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: async () => ({ auth: { userId: 'owner' } }) }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  rpc: state.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'snapshot', project_id: 'project', video_meta: { ...state.meta }, projects: { user_id: 'owner' } } }) }) }) }),
}) }));
vi.mock('@/lib/kling', () => ({ getKlingTask: vi.fn() }));
vi.mock('@/lib/piapi', () => ({ getKlingTask: vi.fn() }));
vi.mock('@/lib/supabase/storage', () => ({ uploadVideo: vi.fn(), isPermanentUrl: vi.fn() }));
vi.mock('@/lib/remotion-export', () => ({ drainRemotionExportQueue: vi.fn(), getRemotionExportJob: vi.fn(), shouldRunRemotionExportInline: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('FAL_KEY', 'test');
  state.meta = { taskId: 'fal-h3max-turbo-small', model: 'minimax-h3-max', status: 'processing', creditsCharged: 80 };
  state.rpc.mockReset().mockImplementation(async (_name, params) => {
    if (state.meta.status !== 'processing') return { data: [{ processed: false, refunded_credits: 0 }] };
    state.meta = { ...state.meta, status: 'failed', error: params.p_error, refunded: true };
    return { data: [{ processed: true, refunded_credits: 80 }] };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function poll() {
  const { GET } = await import('@/app/api/video-snapshot/[snapshotId]/route');
  return GET(new NextRequest('https://www.makaron.app/api/video-snapshot/snapshot'), { params: Promise.resolve({ snapshotId: 'snapshot' }) });
}

it('returns failed, invokes the atomic refund, and stops provider/refund polling on refresh', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
    .mockResolvedValueOnce(Response.json({ detail: [{ type: 'image_too_small' }] }, { status: 422 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await (await poll()).json()).toMatchObject({ status: 'failed', error: expect.stringContaining('256px') });
  expect(state.rpc).toHaveBeenCalledWith('fail_video_snapshot_and_refund', { p_snapshot_id: 'snapshot', p_error: expect.stringContaining('256px') });
  expect(await (await poll()).json()).toMatchObject({ status: 'failed' });
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not change state or refund when the result endpoint is temporarily unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 })));
  expect((await poll()).status).toBe(500);
  expect(state.meta.status).toBe('processing');
  expect(state.rpc).not.toHaveBeenCalled();
});

it('does not publish a terminal state when the refund transaction fails', async () => {
  state.rpc.mockResolvedValueOnce({ error: { message: 'temporary database failure' } });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async url => String(url).endsWith('/status')
    ? Response.json({ status: 'COMPLETED' }) : Response.json({}, { status: 422 })));
  expect((await poll()).status).toBe(500);
  expect(state.meta.status).toBe('processing');
  expect(await (await poll()).json()).toMatchObject({ status: 'failed' });
  expect(state.rpc).toHaveBeenCalledTimes(2);
});
