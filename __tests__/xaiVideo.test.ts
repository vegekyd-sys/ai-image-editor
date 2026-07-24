import { afterEach, describe, expect, it, vi } from 'vitest'
import { getXaiVideoTask } from '@/lib/xai-video'

describe('xAI video status', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('maps a content moderation HTTP 400 to a terminal failed task', async () => {
    vi.stubEnv('XAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Generated video rejected by content moderation.' },
      usage: { cost_in_usd_ticks: 8_100_000_000 },
    }), { status: 400 })))

    await expect(getXaiVideoTask('xai-request-1')).resolves.toEqual({
      taskId: 'xai-request-1',
      status: 'failed',
      error: 'Generated video rejected by content moderation.',
      costUsd: 0.81,
    })
  })

  it('keeps retryable provider errors on the exception path', async () => {
    vi.stubEnv('XAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 503 })))

    await expect(getXaiVideoTask('xai-request-2')).rejects.toThrow(
      'xAI video status error 503: upstream unavailable',
    )
  })

  it('still maps a successful provider response to completed', async () => {
    vi.stubEnv('XAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'done',
      video: { url: 'https://example.com/video.mp4', duration: 10 },
      usage: { cost_in_usd_ticks: 8_100_000_000 },
    }), { status: 200 })))

    await expect(getXaiVideoTask('request-3')).resolves.toEqual({
      taskId: 'xai-request-3',
      status: 'completed',
      videoUrl: 'https://example.com/video.mp4',
      error: undefined,
      duration: 10,
      costUsd: 0.81,
      progress: undefined,
    })
  })
})
