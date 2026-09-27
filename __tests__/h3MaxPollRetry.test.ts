import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForFalH3MaxVideoTask } from '@/lib/fal-h3-max-video'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('H3 Max paid task polling', () => {
  it('recovers the original completed task after a transient 504 without resubmitting', async () => {
    vi.stubEnv('FAL_KEY', 'test-key')
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ video: { url: 'https://example.com/complete.mp4' }, duration: 30 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const taskId = 'fal-h3max-extend-test-request'
    const result = await waitForFalH3MaxVideoTask(taskId, { timeoutMs: 1000, pollIntervalMs: 0 })

    expect(result).toMatchObject({ taskId, status: 'completed', videoUrl: 'https://example.com/complete.mp4', duration: 30 })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/requests/test-request'))).toBe(true)
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })
})
