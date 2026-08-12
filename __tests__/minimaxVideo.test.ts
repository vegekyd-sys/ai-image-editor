import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('MiniMax H3 video adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('MINIMAX_API_KEY', 'test-minimax-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('creates a 2K multimodal reference task with the V2 content contract', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.minimaxi.com/v2/video_generation')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer test-minimax-key',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'MiniMax-H3',
        content: [
          { type: 'text', text: 'Animate reference image 1 to the beat of reference audio 1.' },
          { type: 'image_url', image_url: { url: 'https://example.com/mascot.png' }, role: 'reference_image' },
          { type: 'audio_url', audio_url: { url: 'https://example.com/beat.mp3' }, role: 'reference_audio' },
        ],
        resolution: '2K',
        duration: 15,
        ratio: '16:9',
        aigc_watermark: false,
      })
      return new Response(JSON.stringify({ task_id: '424010985738629' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createMinimaxVideoTask } = await import('@/lib/minimax-video')
    const taskId = await createMinimaxVideoTask({
      prompt: 'Animate <<<media_1>>> to the beat of <<<audio_1>>>.',
      images: ['https://example.com/mascot.png'],
      audioUrls: ['https://example.com/beat.mp3'],
      resolution: '2k',
      duration: 15,
      aspectRatio: '16:9',
    })

    expect(taskId).toBe('minimax-h3-424010985738629')
  })

  it('maps the public 768p UI option to the provider 768P value', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.resolution).toBe('768P')
      expect(body.ratio).toBe('9:16')
      return new Response(JSON.stringify({ task_id: '768-task' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createMinimaxVideoTask } = await import('@/lib/minimax-video')
    await expect(createMinimaxVideoTask({
      prompt: 'A floating mascot rides a neon ribbon.',
      images: [],
      resolution: '768p',
      duration: 15,
      aspectRatio: '9:16',
    })).resolves.toBe('minimax-h3-768-task')
  })

  it('allows each documented multimodal reference maximum in one request', async () => {
    const images = Array.from({ length: 9 }, (_, index) => `https://example.com/image-${index + 1}.png`)
    const videoUrls = Array.from({ length: 3 }, (_, index) => `https://example.com/video-${index + 1}.mp4`)
    const audioUrls = Array.from({ length: 3 }, (_, index) => `https://example.com/audio-${index + 1}.mp3`)
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.content).toHaveLength(16)
      expect(body.content.filter((item: { type: string }) => item.type === 'image_url')).toHaveLength(9)
      expect(body.content.filter((item: { type: string }) => item.type === 'video_url')).toHaveLength(3)
      expect(body.content.filter((item: { type: string }) => item.type === 'audio_url')).toHaveLength(3)
      return new Response(JSON.stringify({ task_id: 'max-multimodal-task' }), { status: 200 })
    }))

    const { createMinimaxVideoTask } = await import('@/lib/minimax-video')
    await expect(createMinimaxVideoTask({
      prompt: 'Use every supplied reference.',
      images,
      videoUrls,
      audioUrls,
      duration: 15,
      resolution: '2k',
    })).resolves.toBe('minimax-h3-max-multimodal-task')
  })

  it('routes native text-to-video through createVideo without requiring source media', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        model: 'MiniMax-H3',
        resolution: '2K',
        duration: 15,
        ratio: '16:9',
      })
      expect(body.content).toEqual([{ type: 'text', text: 'A cinematic Spark portal opens.' }])
      return new Response(JSON.stringify({ task_id: 'native-t2v-task' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createVideo } = await import('@/lib/skills/create-video')
    await expect(createVideo({
      script: 'A cinematic Spark portal opens.',
      images: [],
      duration: 15,
      aspectRatio: '16:9',
      videoModel: 'minimax-h3',
      videoResolution: '2k',
    })).resolves.toMatchObject({
      success: true,
      taskId: 'minimax-h3-native-t2v-task',
      videoModel: 'minimax-h3',
      providerModel: 'MiniMax-H3',
    })
  })

  it('normalizes query states and strips the Makaron task prefix', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://api.minimaxi.com/v2/query/video_generation/424010985738629')
      return new Response(JSON.stringify({
        task: {
          id: '424010985738629',
          status: 'succeeded',
          content: { url: 'https://cdn.example.com/output.mp4' },
          duration: 15,
          resolution: '2K',
          usage: { total_seconds: 15, input_seconds: 0, output_seconds: 15, input_image_count: 1 },
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getMinimaxVideoTask } = await import('@/lib/minimax-video')
    await expect(getMinimaxVideoTask('minimax-h3-424010985738629')).resolves.toMatchObject({
      taskId: 'minimax-h3-424010985738629',
      status: 'completed',
      videoUrl: 'https://cdn.example.com/output.mp4',
      duration: 15,
      resolution: '2K',
      usage: { totalSeconds: 15, outputSeconds: 15, inputImageCount: 1 },
    })
  })

  it('returns terminal provider failures as failed status instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      task: {
        id: 'failed-task',
        status: 'expired',
        error: { code: 'timeout', message: 'generation expired' },
      },
    }), { status: 200 })))

    const { getMinimaxVideoTask } = await import('@/lib/minimax-video')
    await expect(getMinimaxVideoTask('minimax-h3-failed-task')).resolves.toMatchObject({
      status: 'failed',
      error: 'generation expired',
    })
  })
})
