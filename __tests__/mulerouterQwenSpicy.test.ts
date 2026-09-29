import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function taskCreated(id = '11111111-1111-4111-8111-111111111111') {
  return new Response(JSON.stringify({
    task_info: {
      id,
      status: 'pending',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
  }), { status: 202, headers: { 'content-type': 'application/json' } })
}

function taskCompleted() {
  return new Response(JSON.stringify({
    task_info: {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:01Z',
    },
    images: ['https://cdn.example.com/output.webp'],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('MuleRouter Qwen Image Edit Spicy integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('MULEROUTER_API_KEY', 'test-mulerouter-key')
    vi.stubEnv('MULEROUTER_IMAGE_POLL_INTERVAL_MS', '0')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('submits one image, polls, downloads, and cleans up the provider task', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = init?.method || 'GET'
      calls.push({
        url: requestUrl,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (requestUrl === 'https://cdn.example.com/output.webp') {
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        })
      }
      if (method === 'POST') return taskCreated()
      if (method === 'DELETE') return new Response('{}', { status: 200 })
      return taskCompleted()
    }))

    const { qwenSpicyBackend } = await import('@/lib/models/qwen-spicy')
    const result = await qwenSpicyBackend.generate({
      image: 'data:image/jpeg;base64,aW1hZ2U=',
      prompt: 'Add warm window light without changing the face.',
    })

    expect(result).toEqual({
      image: 'data:image/webp;base64,UklGRg==',
      provider: 'mulerouter',
    })
    expect(calls[0]).toMatchObject({
      url: 'https://api.mulerouter.ai/vendors/carrothub/v1/qwen-image-edit-spicy/generation',
      method: 'POST',
      body: {
        image: 'data:image/jpeg;base64,aW1hZ2U=',
        prompt: 'Add warm window light without changing the face.',
      },
    })
    expect(calls.some(call => call.method === 'DELETE')).toBe(true)
  })

  it('uses Z-Image Spicy only for Qwen text-to-image compatibility', async () => {
    let body: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      if (requestUrl === 'https://cdn.example.com/output.webp') {
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        })
      }
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body))
        return taskCreated()
      }
      if (init?.method === 'DELETE') return new Response('{}', { status: 200 })
      return taskCompleted()
    }))

    const { qwenSpicyBackend } = await import('@/lib/models/qwen-spicy')
    const result = await qwenSpicyBackend.generate({ prompt: 'A red lacquer teapot.', aspectRatio: '16:9' })

    expect(result.provider).toBe('mulerouter')
    expect(body).toMatchObject({
      prompt: 'A red lacquer teapot.',
      width: 1536,
      height: 864,
      prompt_extend: false,
    })
  })

  it('submits one primary image plus up to two reference images', async () => {
    let body: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://cdn.example.com/output.webp') {
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        })
      }
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body))
        return taskCreated()
      }
      if (init?.method === 'DELETE') return new Response('{}', { status: 200 })
      return taskCompleted()
    }))
    const { qwenSpicyBackend } = await import('@/lib/models/qwen-spicy')
    const request = {
      prompt: 'Combine the person and background.',
      references: [
        { url: 'https://example.com/base.jpg', role: 'base' },
        { url: 'https://example.com/person.jpg', role: 'person' },
        { url: 'https://example.com/background.jpg', role: 'background' },
      ],
    }

    expect(qwenSpicyBackend.canHandle(request)).toBe(true)
    await expect(qwenSpicyBackend.generate(request)).resolves.toMatchObject({ provider: 'mulerouter' })
    expect(body).toEqual({
      image: 'https://example.com/base.jpg',
      reference_images: [
        'https://example.com/person.jpg',
        'https://example.com/background.jpg',
      ],
      prompt: 'Combine the person and background.',
    })
  })

  it('declines requests with more than three total images', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { qwenSpicyBackend } = await import('@/lib/models/qwen-spicy')
    const request = {
      image: 'https://example.com/base.jpg',
      prompt: 'Combine everything.',
      references: [
        { url: 'https://example.com/one.jpg', role: 'one' },
        { url: 'https://example.com/two.jpg', role: 'two' },
        { url: 'https://example.com/three.jpg', role: 'three' },
      ],
    }

    expect(qwenSpicyBackend.canHandle(request)).toBe(false)
    await expect(qwenSpicyBackend.generate(request)).resolves.toEqual({ image: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces provider failures instead of returning a fake successful image', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return taskCreated()
      if (init?.method === 'DELETE') return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({
        task_info: {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'failed',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:01Z',
          error: { title: 'Generation failed', detail: 'test provider failure' },
        },
      }), { status: 200 })
    }))

    const { generateWithMuleRouterQwenEdit } = await import('@/lib/mulerouter-image')
    await expect(generateWithMuleRouterQwenEdit(['image'], 'prompt')).rejects.toThrow('test provider failure')
  })
})
