import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('fal MiniMax H3 Max Turbo adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('FAL_KEY', 'test-fal-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('submits native 768P Turbo text-to-video by default with a fixed aspect ratio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://queue.fal.run/minimax/h3-max-turbo/text-to-video')
      expect(init?.headers).toMatchObject({ Authorization: 'Key test-fal-key' })
      expect(JSON.parse(String(init?.body))).toEqual({
        prompt: 'A tiny red robot crosses a sunlit studio.',
        duration: 5,
        resolution: '768P',
        enable_safety_checker: true,
        prompt_expansion_mode: 'balanced',
        sync_mode: false,
        aspect_ratio: '9:16',
      })
      return new Response(JSON.stringify({ request_id: 'request-t2v' }), { status: 200 })
    }))

    const { createFalH3MaxVideoTask } = await import('@/lib/fal-h3-max-video')
    await expect(createFalH3MaxVideoTask({
      prompt: 'A tiny red robot crosses a sunlit studio.',
      images: [],
      aspectRatio: '9:16',
    })).resolves.toBe('fal-h3max-turbo-request-t2v')
  })

  it('submits one image through the native 768P image-to-video endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://queue.fal.run/minimax/h3-max-turbo/image-to-video')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        prompt: 'the provided first frame turns toward the camera.',
        duration: 10,
        resolution: '768P',
        image_url: 'https://example.com/start.jpg',
      })
      expect(body).not.toHaveProperty('aspect_ratio')
      expect(body).not.toHaveProperty('end_image_url')
      return new Response(JSON.stringify({ request_id: 'request-i2v' }), { status: 200 })
    }))

    const { createFalH3MaxVideoTask } = await import('@/lib/fal-h3-max-video')
    await expect(createFalH3MaxVideoTask({
      prompt: '<<<media_1>>> turns toward the camera.',
      images: ['https://example.com/start.jpg'],
      duration: 10,
      resolution: '768p',
    })).resolves.toBe('fal-h3max-turbo-request-i2v')
  })

  it('routes createVideo to H3 Max I2V while leaving the global image workflow untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.image_url).toBe('https://example.com/start.jpg')
      return new Response(JSON.stringify({ request_id: 'create-video-i2v' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    await expect(createVideo({
      script: 'Shot 1 (5s): <<<media_1>>> walks toward the camera.',
      images: ['https://example.com/start.jpg'],
      duration: 5,
      videoModel: 'minimax-h3-max',
    })).resolves.toMatchObject({
      success: true,
      taskId: 'fal-h3max-turbo-create-video-i2v',
      videoModel: 'minimax-h3-max',
      providerModel: 'minimax/h3-max-turbo/image-to-video',
    })
  })

  it('rejects unsupported multi-image and duration inputs before submission', async () => {
    const { createFalH3MaxVideoTask } = await import('@/lib/fal-h3-max-video')
    await expect(createFalH3MaxVideoTask({
      prompt: 'Use both images.',
      images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    })).rejects.toThrow('exactly one start image')
    await expect(createFalH3MaxVideoTask({
      prompt: 'Seven seconds.',
      images: [],
      duration: 7,
    })).rejects.toThrow('5, 10, or 15 seconds')
  })

  it('keeps polling durable legacy H3 Max requests after the Turbo cutover', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith('/status')) {
        expect(value).toBe('https://queue.fal.run/minimax/h3-max/requests/request-123/status')
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 })
      }
      expect(value).toBe('https://queue.fal.run/minimax/h3-max/requests/request-123')
      return new Response(JSON.stringify({ video: { url: 'https://example.com/h3-max.mp4' } }), { status: 200 })
    }))

    const { getFalH3MaxVideoTask } = await import('@/lib/fal-h3-max-video')
    await expect(getFalH3MaxVideoTask('fal-h3max-request-123')).resolves.toEqual({
      taskId: 'fal-h3max-request-123',
      status: 'completed',
      videoUrl: 'https://example.com/h3-max.mp4',
    })
  })

  it('waits through transient provider states so the App can receive the first playable URL', async () => {
    let statusCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      expect(value).toContain('https://queue.fal.run/minimax/h3-max-turbo/requests/fast-app')
      if (value.endsWith('/status')) {
        statusCalls += 1
        return new Response(JSON.stringify({
          status: statusCalls < 3 ? 'IN_PROGRESS' : 'COMPLETED',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        video: { url: 'https://v3b.fal.media/files/h3-max.mp4' },
      }), { status: 200 })
    }))

    const { waitForFalH3MaxVideoTask } = await import('@/lib/fal-h3-max-video')
    await expect(waitForFalH3MaxVideoTask('fal-h3max-turbo-fast-app', {
      timeoutMs: 100,
      pollIntervalMs: 1,
    })).resolves.toEqual({
      taskId: 'fal-h3max-turbo-fast-app',
      status: 'completed',
      videoUrl: 'https://v3b.fal.media/files/h3-max.mp4',
    })
    expect(statusCalls).toBe(3)
  })
})
