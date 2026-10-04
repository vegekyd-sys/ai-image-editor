import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { probeMP4Duration } from '@/lib/mp4-probe'

beforeEach(() => { vi.stubEnv('MULEROUTER_API_KEY', 'test-key') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function task() { return new Response(JSON.stringify({ task_info: { id: '00000000-0000-4000-8000-000000000001', status: 'pending' } })) }

it('resolves smart duration and selected images before reserving, then submits the same duration', async () => {
  const order: string[] = []
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    expect(order).toEqual(['billing'])
    const body = JSON.parse(String(options?.body))
    expect(body.duration).toBe(5)
    order.push('provider')
    return task()
  })
  vi.stubGlobal('fetch', fetcher)
  const bill = vi.fn(async () => { order.push('billing') })
  const result = await createVideo({
    script: 'A landscape using <<<media_2>>>.',
    images: ['https://example.com/unselected.png','https://example.com/selected.png'],
    videoModel: 'wan-3.0', videoResolution: '480p', onBeforeProviderSubmit: bill,
  })
  expect(result.success).toBe(true)
  expect(bill).toHaveBeenCalledWith(expect.objectContaining({ model: 'wan-3.0', resolution: '480p', durationSec: 5, imageCount: 1 }))
  expect(order).toEqual(['billing','provider'])
})
it('never contacts the provider when reservation fails', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await createVideo({ script: 'A landscape', images: [], videoModel: 'wan-3.0', duration: 5,
    onBeforeProviderSubmit: async () => { throw new Error('Insufficient credits') } })
  expect(result.success).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
})
it('checks the measured reference-plus-output limit before reserving', async () => {
  const bill = vi.fn()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await createVideo({
    script: 'Continue <<<video_1>>>.', images: [], videoUrls: ['https://example.com/reference.mp4'],
    referenceVideoMetas: [{ width: 1280, height: 720, fileSizeBytes: 1000, durationSec: 5.04 }],
    videoModel: 'wan-3.0', duration: 30, onBeforeProviderSubmit: bill,
  })
  expect(result.success).toBe(false)
  expect(bill).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})
it('parses v0/v1 MP4 movie durations and rejects incomplete headers', () => {
  for (const version of [0,1]) {
    const bytes = new Uint8Array(8 + 48)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length)
    bytes.set(new TextEncoder().encode('moov'),4)
    view.setUint32(8,48)
    bytes.set(new TextEncoder().encode('mvhd'),12)
    bytes[16] = version
    view.setUint32(8 + (version ? 28 : 20),1000)
    if (version) view.setBigUint64(40,BigInt(5040))
    else view.setUint32(32,5040)
    expect(probeMP4Duration(bytes)).toBe(5.04)
    expect(probeMP4Duration(bytes.subarray(0,20))).toBeUndefined()
  }
})
