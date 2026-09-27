import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildH3MaxExtendPayload } from '@/lib/fal-h3-max-extend-video'
import { getFalH3MaxVideoTask } from '@/lib/fal-h3-max-video'
import { createVideo } from '@/lib/skills/create-video'
import { estimateVideoProviderCostUsd, resolvePersistedVideoDuration, resolveVideoProviderModel, validateVideoModelRequest } from '@/lib/video-model-capabilities'
import type { VideoQuoteInput } from '@/lib/billing/media-pricing'
import { validateVideoScript } from '@/lib/video-harness'

const source = 'https://example.com/first-segment.mp4'
const sourceMeta = { durationSec: 15, width: 1344, height: 768, fileSizeBytes: 1_000_000 }

describe('H3 Max Extend', () => {
  const previousKey = process.env.FAL_KEY
  beforeEach(() => { process.env.FAL_KEY = 'test-key' })
  afterEach(() => {
    if (previousKey == null) delete process.env.FAL_KEY
    else process.env.FAL_KEY = previousKey
    vi.restoreAllMocks()
  })

  it('routes extension and prices new footage plus the measured source', () => {
    expect(resolveVideoProviderModel({ model: 'fal-h3-max', hasVideoReference: true, operation: 'extend' }))
      .toBe('minimax/h3-max/extend-video')
    expect(resolvePersistedVideoDuration({ model: 'fal-h3-max', operation: 'extend', outputDuration: 10, referenceVideoDuration: 15 })).toBe(25)
    expect(estimateVideoProviderCostUsd({ model: 'fal-h3-max', operation: 'extend', resolution: '768p', durationSec: 10, referenceVideoDurationSec: 15 }))
      .toBeCloseTo(0.8 + (15 * 7459.2 - 4096) * 0.02 / 1000)
  })

  it('rejects unsupported source shapes before a paid submission', () => {
    const base = { model: 'fal-h3-max', operation: 'extend' as const, outputDuration: 10, hasVideoReference: true, videoReferenceCount: 1 }
    expect(validateVideoModelRequest({ ...base, referenceVideoDuration: 15 })).toBeNull()
    expect(validateVideoModelRequest({ ...base, referenceVideoDuration: 20.667 })).toBeNull()
    expect(validateVideoModelRequest({ ...base, referenceVideoDuration: 61 })).toContain('60 seconds or less')
    expect(validateVideoModelRequest({ ...base, referenceVideoDuration: 1 })).toContain('1.625 seconds')
    expect(validateVideoModelRequest({ ...base, videoReferenceCount: 2 })).toContain('exactly one')
    expect(validateVideoModelRequest({ ...base, imageReferenceCount: 1 })).toContain('without extra image')
    expect(validateVideoModelRequest({ ...base, referenceVideoMetas: [{ fileSizeBytes: 51 * 1024 * 1024 }] })).toContain('50 MB')
    expect(validateVideoModelRequest({ ...base, resolution: '1080p' })).toContain('reference billing')
    expect(validateVideoScript({ prompt: 'Continue the next scene.', imageCount: 0, videoRefUrl: source, videoRefType: 'base', model: 'fal-h3-max', operation: 'extend', duration: 10 })).toBeNull()
  })

  it('submits a full-video continuation, then polls the endpoint-specific queue', async () => {
    const events: string[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const target = String(url)
      if (init?.method === 'POST') {
        events.push('submit')
        expect(target).toBe('https://queue.fal.run/minimax/h3-max/extend-video')
        const body = JSON.parse(String(init.body))
        expect(body).toMatchObject({ video_url: source, prompt: 'The character walks into the next room.', duration: 10, resolution: '768P', output: 'extended' })
        return new Response(JSON.stringify({ request_id: 'extend-123' }), { status: 200 })
      }
      if (target.endsWith('/status')) {
        expect(target).toBe('https://queue.fal.run/minimax/h3-max/requests/extend-123/status')
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 })
      }
      expect(target).toBe('https://queue.fal.run/minimax/h3-max/requests/extend-123')
      return new Response(JSON.stringify({ video: { url: 'https://example.com/full-25s.mp4' }, duration: 25.4 }), { status: 200 })
    })
    const reserved: VideoQuoteInput[] = []
    const created = await createVideo({
      script: 'The character walks into the next room.', images: [], videoUrls: [source],
      referenceVideoMetas: [sourceMeta], referenceVideoDuration: 15,
      duration: 10, videoModel: 'fal-h3-max', videoOperation: 'extend',
      onBeforeProviderSubmit: async usage => { events.push('reserve'); reserved.push(usage) },
    })
    expect(created).toMatchObject({ success: true, taskId: 'fal-h3max-extend-extend-123', providerModel: 'minimax/h3-max/extend-video', sourceDuration: 15 })
    expect(events).toEqual(['reserve', 'submit'])
    expect(reserved[0]).toMatchObject({ model: 'fal-h3-max', operation: 'extend', durationSec: 10, referenceVideoDurationSec: 15 })
    expect(await getFalH3MaxVideoTask(created.taskId!)).toMatchObject({ status: 'completed', videoUrl: 'https://example.com/full-25s.mp4', duration: 25.4 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed continuation payloads', () => {
    const valid = { videoUrl: source, prompt: 'Continue walking.', duration: 10, resolution: '768p' as const }
    expect(buildH3MaxExtendPayload(valid)).toMatchObject({ output: 'extended', aspect_ratio: 'auto' })
    expect(() => buildH3MaxExtendPayload({ ...valid, videoUrl: 'http://example.com/video.mp4' })).toThrow('HTTPS')
    expect(() => buildH3MaxExtendPayload({ ...valid, duration: 16 })).toThrow('5–15')
  })
})
