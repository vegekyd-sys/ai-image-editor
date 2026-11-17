import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  from: vi.fn(), fail: vi.fn(), kling: vi.fn(), worker: vi.fn(), poster: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: m.from }) }))
vi.mock('@/lib/video-lifecycle', () => ({ handleVideoFailure: m.fail }))
vi.mock('@/lib/kling', () => ({ getKlingTask: m.kling }))
vi.mock('@/lib/remotion-export', () => ({ runNextRemotionExportJob: m.worker }))
vi.mock('@/lib/video-poster-repair', () => ({ ensureVideoPosterForSnapshot: m.poster }))
vi.mock('@/lib/video-upscale-pipeline', () => ({ reconcileVideoPipelines: async () => 0 }))
vi.mock('@/lib/video-retake', () => ({ reconcileVideoRetakes: async () => 0 }))
vi.mock('@/lib/billing/mcp-video', () => ({ reconcileMcpVideos: async () => 0 }))
import { GET } from '@/app/api/cron/video-poll/route'

const id = 'ef65edb3-bac9-45af-8c7d-21f900246d98'
const pending = 'remotion-export-pending-' + id
const request = () => ({ headers: new Headers({ authorization: 'Bearer test' }) }) as NextRequest
function setup(taskId: string, jobStatus?: string, options = { user: 'u', project: 'p', changed: true }) {
  const vm = { taskId, status: 'processing', prompt: 'keep description' }
  const snap = { id: 'card', project_id: 'p', projects: { user_id: 'u' }, created_at: new Date(0).toISOString(), video_meta: vm }
  const jobs = jobStatus ? [{ id, status: jobStatus, project_id: options.project, user_id: options.user,
    storage_url: 'https://media.test/output.mp4', width: 1920, height: 1080, duration_seconds: 20, error: 'export failed' }] : []
  const reads = vi.fn(), writes = vi.fn(), guards = vi.fn()
  // Emulate Supabase's awaitable builders and the guarded update returning its matched row.
  m.from.mockImplementation((table: string) => {
    let updating = false
    const q = { select: vi.fn(() => q), lt: vi.fn(() => q), eq: vi.fn((...args) => { if (updating) guards(...args); return q }),
      filter: vi.fn(() => q), order: vi.fn(() => q), in: vi.fn((...args) => { reads(...args); return q }),
      limit: vi.fn(async () => ({ data: [snap] })), update: vi.fn((value) => { updating = true; writes(value); return q }),
      maybeSingle: vi.fn(async () => ({ data: options.changed ? { id: 'card' } : null })),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'remotion_export_jobs' ? jobs : [] }).then(resolve),
    }
    return q
  })
  return { reads, writes, guards }
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'test'); m.worker.mockResolvedValue(null) })
afterEach(() => vi.unstubAllEnvs())

describe('stale video cron: use the owning job for Remotion snapshots', () => {
  it.each([pending, 'remotion-export-' + id])('settles from the completed export even after the provider timeout: %s', async taskId => {
    const { reads, writes, guards } = setup(taskId, 'completed')
    expect(await (await GET(request())).json()).toMatchObject({ processed: 1 })
    expect(reads).toHaveBeenCalledWith('id', [id])
    expect(writes).toHaveBeenCalledWith({ video_meta: expect.objectContaining({ taskId: 'remotion-export-' + id,
      status: 'completed', videoUrl: 'https://media.test/output.mp4', width: 1920, height: 1080, duration: 20, prompt: 'keep description' }) })
    expect(guards).toHaveBeenCalledWith('video_meta->>status', 'processing')
    expect(guards).toHaveBeenCalledWith('video_meta->>taskId', taskId)
    expect(m.kling).not.toHaveBeenCalled(); expect(m.fail).not.toHaveBeenCalled()
  })
  it.each(['queued', 'rendering', undefined])('leaves %s exports with their worker', async status => {
    const { writes } = setup(pending, status)
    expect(await (await GET(request())).json()).toMatchObject({ processed: 0 })
    expect(writes).not.toHaveBeenCalled(); expect(m.kling).not.toHaveBeenCalled(); expect(m.fail).not.toHaveBeenCalled()
    expect(m.worker).toHaveBeenCalledOnce()
  })
  it.each([['other-user','p'],['u','other-project']])('does not copy an unrelated export into this card', async (user, project) => {
    const { writes } = setup(pending, 'completed', { user, project, changed: true })
    await GET(request())
    expect(writes).not.toHaveBeenCalled(); expect(m.kling).not.toHaveBeenCalled(); expect(m.fail).not.toHaveBeenCalled()
  })
  it('uses the renderer failure without invoking external-provider refunds', async () => {
    const { writes } = setup(pending, 'failed')
    await GET(request())
    expect(writes).toHaveBeenCalledWith({ video_meta: expect.objectContaining({ status: 'failed', error: 'export failed' }) })
    expect(m.fail).not.toHaveBeenCalled()
  })
  it('does not count a concurrently settled card', async () => {
    setup(pending, 'completed', { user: 'u', project: 'p', changed: false })
    expect(await (await GET(request())).json()).toMatchObject({ processed: 0 })
  })
  it('keeps ordinary Kling polling and failure handling, without an export lookup', async () => {
    setup('opaque-kling-task')
    m.kling.mockResolvedValue({ status: 'failed', error: 'provider failure' })
    m.fail.mockResolvedValue(true)
    expect(await (await GET(request())).json()).toMatchObject({ processed: 1 })
    expect(m.kling).toHaveBeenCalledWith('opaque-kling-task'); expect(m.fail).toHaveBeenCalledWith('card', 'provider failure')
    expect(m.from).not.toHaveBeenCalledWith('remotion_export_jobs')
  })
})
