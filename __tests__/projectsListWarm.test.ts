import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ cached: [] as unknown[], written: null as unknown }))
vi.mock('@/lib/imageCache', () => ({
  getCachedProjectsListSync: () => state.cached,
  cacheProjectsList: (userId: string, projects: unknown[]) => { state.written = { userId, projects } },
}))
import { warmProjectsListCache } from '@/lib/projects-list-warm'
const row = {
  id: 'project-1', title: 'Project', cover_url: null,
  updated_at: '2026-11-13T00:00:00Z', created_at: '2026-11-13T00:00:00Z',
  snapshots: [{ id: 's-1', image_url: 'https://example.com/image.jpg', sort_order: 8 }], snapshotCount: 9, hasVideo: true,
}
beforeEach(() => { state.cached = []; state.written = null })
afterEach(() => vi.unstubAllGlobals())

describe('gallery navigation warmup', () => {
  it('warms only the first bounded page with real media summaries', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [row], scannedIds: [row.id], nextCursor: 'older' }) })
    vi.stubGlobal('fetch', fetch)
    await warmProjectsListCache('owner')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/projects/gallery')
    expect(state.written).toEqual({ userId: 'owner', projects: [row] })
  })
  it('does not replace the cache when media loading fails', async () => {
    state.cached = [row]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await warmProjectsListCache('owner')
    expect(state.written).toBeNull()
    expect(state.cached).toEqual([row])
  })
})
