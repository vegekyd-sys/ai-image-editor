import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mp4Fixture } from './helpers/mp4Fixture'

const insertSnapshot = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn(async () => ({ auth: { userId: 'user-1', supabase: {
    from: (table: string) => table === 'snapshots' ? { insert: insertSnapshot } : {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'project-1' }, error: null }) }) }) }),
    },
    rpc: async () => ({ data: 0, error: null }),
    storage: { from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.makaron.app/poster.jpg' } }),
    }) },
  } } })),
}))
vi.mock('@/lib/video-poster', () => ({ extractVideoPoster: async () => Buffer.from('poster') }))

describe('project video imports preserve measured duration', () => {
  beforeEach(() => {
    insertSnapshot.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mp4Fixture(5.184))))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('stores duration for a permanent URL (existing project: %s)', async (existing) => {
    const { POST } = await import('@/app/api/projects/create/route')
    const response = await POST(new NextRequest('http://localhost/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrls: ['https://cdn.makaron.app/storage/v1/object/public/images/source.mp4'],
        ...(existing ? { _addToProject: '44444444-4444-4444-8444-444444444444' } : {}),
      }),
    }))
    expect(response.status).toBe(200)
    expect(insertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      type: 'video', video_meta: expect.objectContaining({ origin: 'source-upload', duration: 5.184 }),
    }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
