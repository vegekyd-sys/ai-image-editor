import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  job: undefined as any, rejectLease: false, staleAtClaim: false,
  create: vi.fn(), generateStatus: vi.fn(), submit: vi.fn(), poll: vi.fn(), refund: vi.fn(), upload: vi.fn(),
  download: vi.fn(), inspect: vi.fn(), finish: vi.fn(),
}))
vi.mock('@/lib/skills/create-video', () => ({ createVideo: mocks.create }))
vi.mock('@/lib/evolink', () => ({ getEvolinkTask: mocks.generateStatus }))
vi.mock('@/lib/bytedance-video-upscale', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/bytedance-video-upscale')>(), submitByteDanceUpscale: mocks.submit, pollByteDanceUpscale: mocks.poll,
}))
vi.mock('@/lib/video-upscale-media', () => ({ downloadUpscaleMedia: mocks.download, inspectUpscaleMedia: mocks.inspect, finishUpscaleMedia: mocks.finish }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from: () => {
    let update: any; const filters: Record<string, unknown> = {}
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query }, or: () => query,
      insert: async (job: any) => { mocks.job = { ...job, updated_at: 'initial', lease_until: null }; return { error: null } },
      update: (patch: any) => { update = patch; return query },
      maybeSingle: async () => {
        if (!mocks.job || Object.entries(filters).some(([k,v]) => mocks.job[k] !== v)) return { data: null, error: null }
        if (update?.lease_token && mocks.staleAtClaim) { mocks.job.updated_at = 'newer'; return { data: null, error: null } }
        if (update?.lease_token && (mocks.rejectLease || mocks.job.lease_until)) return { data: null, error: null }
        if (update) Object.assign(mocks.job, update)
        return { data: structuredClone(mocks.job), error: null }
      },
      then: (resolve: any) => { if (update && Object.entries(filters).every(([k,v]) => mocks.job[k] === v)) Object.assign(mocks.job, update); return Promise.resolve({ error: null }).then(resolve) },
    }
    return query
  },
  rpc: mocks.refund,
  storage: { from: () => ({ upload: mocks.upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
}) }))

import { advanceVideoPipeline, createVideoPipeline } from '@/lib/video-upscale-pipeline'
import { UpscaleSubmissionError } from '@/lib/bytedance-video-upscale'

const owner = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const task = 'video-pipeline-' + id
function root(stage: string, extra = {}) {
  return { id, user_id: owner, project_id: null, model_id: 'seedance-2.5-eco', resolution: '4k', stage,
    updated_at: 'initial', lease_until: null, base_url: 'https://storage.example/base.mp4', preset: 'aigc',
    source_meta: { duration: 10.08, fps: 24, width: 854, height: 480 }, ...extra }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('FAL_KEY', 'test'); mocks.job = undefined; mocks.rejectLease = false; mocks.staleAtClaim = false
  mocks.create.mockResolvedValue({ success: true, taskId: 'task-unified-generation' })
  mocks.generateStatus.mockResolvedValue({ status: 'completed', videoUrl: 'https://provider.example/base.mp4' })
  mocks.submit.mockResolvedValue('fal-request'); mocks.poll.mockResolvedValue({ status: 'processing' })
  mocks.download.mockResolvedValue(Buffer.from('video')); mocks.inspect.mockResolvedValue({ duration: 10.08, fps: 24, width: 854, height: 480 })
  mocks.finish.mockResolvedValue({ bytes: Buffer.from('final'), meta: { duration: 10.08, fps: 24, width: 3844, height: 2160 } })
  mocks.upload.mockResolvedValue({ error: null }); mocks.refund.mockResolvedValue({ error: null })
})
describe('recoverable Eco and independent enhancement', () => {
  it.each([undefined, 'auto'] as const)('generates 480p then bills and submits 720p delivery when resolution is %s', async videoResolution => {
    const reserve = vi.fn().mockResolvedValue({ reservedUpscaleCredits: 15 })
    mocks.create.mockImplementationOnce(async input => {
      await input.onBeforeProviderSubmit({ model: 'seedance-2.5', resolution: '480p', durationSec: 10 })
      return { success: true, taskId: 'task-unified-generation' }
    })
    const result = await createVideoPipeline({ script: 'Mascot', images: [], userId: owner, videoModel: 'seedance-2.5-eco', videoResolution, duration: 10, onBeforeProviderSubmit: reserve })
    expect(result.success).toBe(true)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ videoModel: 'seedance-2.5', videoResolution: '480p' }))
    expect(reserve).toHaveBeenCalledWith({ model: 'seedance-2.5-eco', resolution: '720p', durationSec: 10 })
    expect(mocks.job).toMatchObject({ resolution: '720p', reserved_upscale_credits: 15 })
    await advanceVideoPipeline(result.taskId!, owner)
    expect(mocks.submit).toHaveBeenCalledWith({ videoUrl: mocks.job.base_url, resolution: '720p', fps: 24, preset: 'aigc' })
  })
  it('creates Eco at 480p and preserves the requested final 4K route', async () => {
    const result = await createVideoPipeline({ script: 'Mascot', images: [], userId: owner, videoModel: 'seedance-2.5-eco', videoResolution: '4k', duration: 10, reservedUpscaleCredits: 58 })
    expect(result).toMatchObject({ success: true, videoModel: 'seedance-2.5-eco' })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ videoModel: 'seedance-2.5', videoResolution: '480p' }))
    expect(mocks.job).toMatchObject({ resolution: '4k', generation_task_id: 'task-unified-generation', reserved_upscale_credits: 58 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('does not submit or expose a root to the wrong owner', async () => {
    mocks.job = root('ready_to_upscale')
    await expect(advanceVideoPipeline(task, 'someone-else')).rejects.toThrow('not owned')
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('does not run a paid submission under an occupied or stale lease', async () => {
    mocks.job = root('ready_to_upscale'); mocks.rejectLease = true
    expect((await advanceVideoPipeline(task, owner)).status).toBe('processing')
    mocks.rejectLease = false; mocks.staleAtClaim = true
    await advanceVideoPipeline(task, owner)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('submits a persisted base only once across repeated polls', async () => {
    mocks.job = root('ready_to_upscale')
    await advanceVideoPipeline(task, owner); await advanceVideoPipeline(task, owner)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit).toHaveBeenCalledWith({ videoUrl: mocks.job.base_url, resolution: '4k', fps: 24, preset: 'aigc' })
    expect(mocks.job.stage).toBe('upscaling')
  })
  it('keeps an uncertain POST frozen and never repeats it', async () => {
    mocks.job = root('ready_to_upscale'); mocks.submit.mockRejectedValueOnce(new UpscaleSubmissionError(true))
    await advanceVideoPipeline(task, owner); await advanceVideoPipeline(task, owner)
    expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.job.stage).toBe('submission_uncertain')
    expect(mocks.refund).not.toHaveBeenCalled()
  })
  it('retains base 480p on confirmed enhancement failure with partial refund', async () => {
    mocks.job = root('upscaling', { upscale_request_id: 'fal-request' }); mocks.poll.mockResolvedValueOnce({ status: 'failed' })
    const result = await advanceVideoPipeline(task, owner)
    expect(result).toMatchObject({ status: 'completed', videoUrl: mocks.job.base_url, actualResolution: '480p', requestedResolution: '4k', enhancementStatus: 'failed' })
    expect(mocks.refund).toHaveBeenCalledWith('refund_video_upscale_stage', { p_id: id, p_user_id: owner })
  })
  it('does not refund or repost on transport failure', async () => {
    mocks.job = root('upscaling', { upscale_request_id: 'fal-request' }); mocks.poll.mockRejectedValueOnce(new Error('network'))
    await expect(advanceVideoPipeline(task, owner)).rejects.toThrow('network')
    expect(mocks.job.stage).toBe('upscaling'); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.refund).not.toHaveBeenCalled()
  })
  it('retries saving the same completed result without paying for it again', async () => {
    mocks.job = root('saving_final', { output_provider_url: 'https://provider.example/final.mp4' }); mocks.upload.mockResolvedValueOnce({ error: { message: 'storage' } })
    await expect(advanceVideoPipeline(task, owner)).rejects.toThrow('save video')
    expect(mocks.job.stage).toBe('saving_final')
    expect((await advanceVideoPipeline(task, owner)).status).toBe('completed')
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('quotes source duration and fps for standalone enhancement without Seedance', async () => {
    const reserve = vi.fn().mockResolvedValue(undefined)
    const result = await createVideoPipeline({ script: 'Upscale', images: [], videoUrl: 'https://example.com/source.mp4', userId: owner, videoModel: 'bytedance-video-upscale', videoResolution: '2k', onBeforeProviderSubmit: reserve })
    expect(result.success).toBe(true)
    expect(reserve).toHaveBeenCalledWith({ model: 'bytedance-video-upscale', resolution: '2k', durationSec: 10.08, outputFps: 24 })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
