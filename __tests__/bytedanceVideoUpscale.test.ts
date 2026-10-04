import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUpscaleInput, pollByteDanceUpscale, submitByteDanceUpscale, UpscaleSubmissionError } from '@/lib/bytedance-video-upscale'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('ByteDance Fast provider boundary', () => {
  it('sets Fast/high fidelity/numeric bit depth and preserves measured fps', () => {
    expect(buildUpscaleInput({ videoUrl: 'https://example.com/video.mp4', resolution: '4k', fps: 24, preset: 'aigc' })).toMatchObject({ target_resolution: '4k', target_fps: 24, bit_depth: 8, enhancement_tier: 'fast', fidelity: 'high', enhancement_preset: 'aigc' })
  })
  it('uses a 1080p provider pass for the product 720p delivery tier', () => {
    expect(buildUpscaleInput({ videoUrl: 'https://example.com/video.mp4', resolution: '720p', fps: 24 })).toMatchObject({ target_resolution: '1080p', target_fps: 24 })
  })
  it('never retries an ambiguous paid submission', async () => {
    vi.stubEnv('FAL_KEY', 'test'); const fetch = vi.fn().mockRejectedValue(new Error('transport')); vi.stubGlobal('fetch', fetch)
    await expect(submitByteDanceUpscale({ videoUrl: 'https://example.com/video.mp4', resolution: '1080p', fps: 24 })).rejects.toBeInstanceOf(UpscaleSubmissionError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('distinguishes confirmed input failure from unavailable polling', async () => {
    vi.stubEnv('FAL_KEY', 'test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"status":"COMPLETED"}')).mockResolvedValueOnce(new Response('{}', { status: 422 })))
    expect((await pollByteDanceUpscale('request')).status).toBe('failed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(pollByteDanceUpscale('request')).rejects.toThrow('retain')
  })
})
