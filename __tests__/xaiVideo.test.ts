import { afterEach, describe, expect, it, vi } from 'vitest'
import { createXaiVideoTask, getXaiVideoTask } from '@/lib/xai-video'

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

describe('xAI video submission modes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function mockSubmission(requestId = 'request-1') {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: requestId }), { status: 200 }))
    vi.stubEnv('XAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('uses 1.5 native text-to-video with 1080p, aspect ratio, and audio control', async () => {
    const fetchMock = mockSubmission()
    await expect(createXaiVideoTask({
      prompt: 'A paper boat in rain',
      images: [],
      duration: 5,
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: false,
    })).resolves.toEqual({
      taskId: 'xai-request-1',
      providerModel: 'grok-imagine-video-1.5',
      mode: 'text-to-video',
      provider: 'xai-api',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/videos/generations')
    expect(JSON.parse(init.body)).toEqual({
      model: 'grok-imagine-video-1.5',
      prompt: 'A paper boat in rain',
      duration: 5,
      resolution: '1080p',
      generate_audio: false,
      aspect_ratio: '9:16',
    })
  })

  it('uses reference-to-video for a single image instead of locking it as the first frame', async () => {
    const fetchMock = mockSubmission()
    await expect(createXaiVideoTask({
      prompt: 'Animate <<<media_1>>> with a slow push-in',
      images: ['https://example.com/source.jpg'],
      aspectRatio: '16:9',
      resolution: '720p',
    })).resolves.toMatchObject({ mode: 'reference-to-video' })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'grok-imagine-video-1.5',
      prompt: 'Animate <IMAGE_1> with a slow push-in',
      reference_images: [{ url: 'https://example.com/source.jpg' }],
      resolution: '720p',
      aspect_ratio: '16:9',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('image')
  })

  it('uses reference_images and xAI markers for multi-image generation', async () => {
    const fetchMock = mockSubmission()
    await expect(createXaiVideoTask({
      prompt: 'Person from <<<media_1>>> wears the product from <<<media_2>>>',
      images: ['https://example.com/person.jpg', 'https://example.com/product.jpg'],
      resolution: '720p',
      referenceVoiceIds: ['eve'],
    })).resolves.toMatchObject({ mode: 'reference-to-video' })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      prompt: 'Person from <IMAGE_1> wears the product from <IMAGE_2>',
      reference_images: [
        { url: 'https://example.com/person.jpg' },
        { url: 'https://example.com/product.jpg' },
      ],
      reference_audios: [{ voice_id: 'eve' }],
      resolution: '720p',
    })
  })

  it('routes edit to the base model and omits generation-only controls', async () => {
    const fetchMock = mockSubmission('edit-1')
    await expect(createXaiVideoTask({
      prompt: 'Add gentle rain',
      images: [],
      videoUrl: 'https://example.com/source.mp4',
      operation: 'edit',
      duration: 5,
      resolution: '1080p',
      aspectRatio: '9:16',
    })).resolves.toEqual({
      taskId: 'xai-edit-1',
      providerModel: 'grok-imagine-video',
      mode: 'edit-video',
      provider: 'xai-api',
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.x.ai/v1/videos/edits')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'grok-imagine-video',
      prompt: 'Add gentle rain',
      video: { url: 'https://example.com/source.mp4' },
    })
  })

  it('routes extension to the base model with only the added duration', async () => {
    const fetchMock = mockSubmission('extend-1')
    await createXaiVideoTask({
      prompt: 'Continue the camera move',
      images: [],
      videoUrl: 'https://example.com/source.mp4',
      operation: 'extend',
      duration: 8,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.x.ai/v1/videos/extensions')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'grok-imagine-video',
      prompt: 'Continue the camera move',
      video: { url: 'https://example.com/source.mp4' },
      duration: 8,
    })
  })

  it('rejects 1080p reference requests even when there is only one image', async () => {
    const fetchMock = mockSubmission()
    await expect(createXaiVideoTask({
      prompt: 'Use the reference',
      images: ['https://example.com/a.jpg'],
      resolution: '1080p',
    })).rejects.toThrow('reference-to-video is capped at 720p')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
