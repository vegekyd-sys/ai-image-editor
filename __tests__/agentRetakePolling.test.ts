// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ advance: vi.fn(), kling: vi.fn(), after: vi.fn() }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: async () => ({ auth: { userId: 'owner' } }) }));
vi.mock('@/lib/video-retake', () => ({ advanceVideoRetake: mocks.advance }));
vi.mock('@/lib/kling', () => ({ getKlingTask: mocks.kling }));
vi.mock('@/lib/agent-execution-dispatch', () => ({ dispatchAgentExecutionAttempt: vi.fn() }));
vi.mock('@/lib/workspace', () => ({ resolveWorkspaceFile: vi.fn() }));
vi.mock('@/lib/billing/run-usage', () => ({ getRunUsage: vi.fn(async () => ({})) }));
vi.mock('@/lib/billing/credits', () => ({ getBalance: vi.fn(async () => ({ balance: 0 })) }));
vi.mock('@/lib/supabase/storage', () => ({ isPermanentUrl: (url: string) => url.startsWith('https://cdn.makaron.app/') }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    const data = table === 'agent_runs' ? { id: 'run', status: 'completed', user_id: 'owner', project_id: 'project', metadata: {}, started_at: new Date().toISOString() }
      : table === 'snapshots' ? { id: 'snapshot', video_meta: { status: 'processing', taskId: 'video-retake-job' } }
      : [{ type: 'video_snapshot', seq: 1, data: { taskId: 'video-retake-job', snapshotId: 'snapshot' } }];
    const result = { data, error: null, count: 1 };
    const query: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
    for (const method of ['select','eq','in','order','limit','gte','single','maybeSingle','update']) query[method] = () => query;
    return query;
  },
}) }));
import { GET } from '@/app/api/agent/run/[id]/route';

it('completes a CLI response through the owned Retake job without browser polling or republishing its final file', async () => {
  const url = 'https://cdn.makaron.app/retake-job-final-contenthash.mp4';
  mocks.advance.mockResolvedValue({ status: 'completed', videoUrl: url });
  const response = await GET(new NextRequest('https://makaron.app/api/agent/run/run'), { params: Promise.resolve({ id: 'run' }) });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(mocks.advance).toHaveBeenCalledWith('video-retake-job', 'owner');
  expect(mocks.kling).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(body).toMatchObject({ status: 'completed', incomplete: false, output: [{ type: 'video', status: 'completed', url }] });
});
