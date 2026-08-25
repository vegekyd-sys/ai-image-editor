import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Sync Lipsync v3 adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('submits one video and one exact audio track in remap mode', async () => {
    vi.stubEnv('FAL_KEY', 'test-fal-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://queue.fal.run/fal-ai/sync-lipsync/v3')
      expect(init?.headers).toMatchObject({ Authorization: 'Key test-fal-key' })
      expect(JSON.parse(String(init?.body))).toEqual({
        video_url: 'https://example.com/source.mp4',
        audio_url: 'https://example.com/translated.wav',
        sync_mode: 'remap',
      })
      return new Response(JSON.stringify({ request_id: 'request-123' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createSyncLipsyncTask } = await import('@/lib/sync-lipsync')
    await expect(createSyncLipsyncTask({
      videoUrl: 'https://example.com/source.mp4',
      audioUrl: 'https://example.com/translated.wav',
    })).resolves.toBe('sync3-request-123')
  })

  it('polls the completed result using the durable task prefix', async () => {
    vi.stubEnv('FAL_KEY', 'test-fal-key')
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 })
      }
      return new Response(JSON.stringify({ video: { url: 'https://example.com/synced.mp4' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getSyncLipsyncTask } = await import('@/lib/sync-lipsync')
    await expect(getSyncLipsyncTask('sync3-request-123')).resolves.toEqual({
      taskId: 'sync3-request-123',
      status: 'completed',
      videoUrl: 'https://example.com/synced.mp4',
    })
  })
})

