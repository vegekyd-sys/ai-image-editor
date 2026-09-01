import { afterEach, describe, expect, it, vi } from 'vitest'
import { createXaiVideoTask, getXaiVideoTask } from '@/lib/xai-video'

const OWNER_ID = 'grok-owner-id'

function enableSubscription() {
  vi.stubEnv('GROK_SUBSCRIPTION_RELAY_URL', 'https://relay.example.com')
  vi.stubEnv('GROK_SUBSCRIPTION_RELAY_SECRET', 'relay-secret')
  vi.stubEnv('GROK_SUBSCRIPTION_OWNER_USER_ID', OWNER_ID)
}

describe('Grok Imagine personal-plan routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('creates a subscription-prefixed task after relay preflight succeeds', async () => {
    enableSubscription()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"request_id":"personal-1"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createXaiVideoTask({
      prompt: 'A tiny paper rocket lifts off',
      images: [],
      duration: 1,
      resolution: '480p',
    }, { userId: OWNER_ID })).resolves.toEqual({
      taskId: 'xai-sub-personal-1',
      providerModel: 'grok-imagine-video-1.5',
      mode: 'text-to-video',
      provider: 'grok-subscription',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example.com/v1/preflight')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://relay.example.com/v1/videos/generations')
  })

  it('falls back to the direct API only after a side-effect-free preflight failure', async () => {
    enableSubscription()
    vi.stubEnv('XAI_API_KEY', 'api-key')
    const beforeFallback = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"xai_oauth_missing"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"request_id":"api-1"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createXaiVideoTask({
      prompt: 'A paper boat on a pond',
      images: [],
      duration: 1,
    }, { userId: OWNER_ID, onBeforeApiFallback: beforeFallback })).resolves.toMatchObject({
      taskId: 'xai-api-1',
      provider: 'xai-api',
    })

    expect(beforeFallback).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.x.ai/v1/videos/generations')
  })

  it('fails closed when the relay submission outcome is unknown', async () => {
    enableSubscription()
    vi.stubEnv('XAI_API_KEY', 'api-key')
    const beforeFallback = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockRejectedValueOnce(new Error('connection reset after upload'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createXaiVideoTask({
      prompt: 'A paper kite in the wind',
      images: [],
      duration: 1,
    }, { userId: OWNER_ID, onBeforeApiFallback: beforeFallback }))
      .rejects.toThrow('GROK_SUBSCRIPTION_RELAY_UNKNOWN_OUTCOME')

    expect(beforeFallback).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('polls subscription tasks through the relay instead of the direct API', async () => {
    enableSubscription()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'done',
      video: { url: 'https://example.com/personal.mp4', duration: 1 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getXaiVideoTask('xai-sub-personal-1', OWNER_ID)).resolves.toMatchObject({
      taskId: 'xai-sub-personal-1',
      status: 'completed',
      videoUrl: 'https://example.com/personal.mp4',
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example.com/v1/videos/personal-1')
  })
})
