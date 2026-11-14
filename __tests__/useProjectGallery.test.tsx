import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectGallery } from '@/hooks/useProjectGallery'
import { mergeProjectGalleryPage, type GalleryProject, type ProjectGalleryPage } from '@/lib/project-gallery'

const project = (index: number): GalleryProject => ({
  id: `project-${index}`, title: `Project ${index}`, cover_url: null,
  created_at: new Date(Date.UTC(2026, 0, 1) - index * 1000).toISOString(), updated_at: '2026-11-13T00:00:00Z',
  snapshots: [{ id: `s-${index}`, image_url: 'https://example.com/image.jpg', sort_order: 0 }], snapshotCount: 8,
})
const response = (page: ProjectGalleryPage) => ({ ok: true, status: 200, json: async () => page })

afterEach(() => vi.unstubAllGlobals())

describe('project gallery pagination and failure recovery', () => {
  it('can load all projects beyond 1000 without duplicate cards', async () => {
    const all = Array.from({ length: 1103 }, (_, index) => project(index))
    let current: GalleryProject[] = []
    const fetch = vi.fn(async (url: string) => {
      const offset = Number(new URL(url, 'https://example.com').searchParams.get('cursor') ?? 0)
      const projects = all.slice(offset, offset + 24)
      return response({ projects, scannedIds: projects.map(p => p.id), nextCursor: offset + 24 < all.length ? String(offset + 24) : null })
    })
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useProjectGallery({
      userId: 'owner', refreshKey: 0, currentProjects: () => current, onProjects: next => { current = next }, onInitialError: vi.fn(),
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    while (result.current.hasMore) await act(() => result.current.loadMore())
    expect(current.map(p => p.id)).toEqual(all.map(p => p.id))
    expect(new Set(current.map(p => p.id)).size).toBe(1103)
    expect(fetch).toHaveBeenCalledTimes(46)
  })

  it('keeps existing projects and retries the same cursor after a snapshot timeout', async () => {
    let current = [project(100)]
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ projects: [project(1)], scannedIds: ['project-1'], nextCursor: 'next' }))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response({ projects: [project(2)], scannedIds: ['project-2'], nextCursor: null }))
    vi.stubGlobal('fetch', fetch)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useProjectGallery({
      userId: 'owner', refreshKey: 0, currentProjects: () => current, onProjects: next => { current = next }, onInitialError: vi.fn(),
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const beforeFailure = current
    await act(() => result.current.loadMore())
    expect(result.current.failed).toBe(true)
    expect(current).toBe(beforeFailure)
    await act(() => result.current.loadMore())
    expect(fetch.mock.calls[1][0]).toBe('/api/projects/gallery?cursor=next')
    expect(fetch.mock.calls[2][0]).toBe(fetch.mock.calls[1][0])
    expect(current.map(p => p.id)).toEqual(['project-1', 'project-2'])
    expect(result.current.failed).toBe(false)
    consoleError.mockRestore()
  })

  it('keeps the cursor after an empty page and removes only confirmed empty cached projects', () => {
    const current = [project(1), project(2), project(3)]
    const next = mergeProjectGalleryPage(current, { projects: [project(1)], scannedIds: ['project-1', 'project-2'], nextCursor: 'older' })
    expect(next.map(p => p.id)).toEqual(['project-1', 'project-3'])
  })

  it('ignores a previous account response after the owner changes', async () => {
    let resolveOld!: (value: unknown) => void
    let current: GalleryProject[] = []
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(response({ projects: [project(2)], scannedIds: ['project-2'], nextCursor: null }))
    vi.stubGlobal('fetch', fetch)
    const { rerender } = renderHook(({ userId }) => useProjectGallery({
      userId, refreshKey: 0, currentProjects: () => current, onProjects: next => { current = next }, onInitialError: vi.fn(),
    }), { initialProps: { userId: 'old-owner' } })
    rerender({ userId: 'new-owner' })
    await waitFor(() => expect(current.map(p => p.id)).toEqual(['project-2']))
    await act(async () => { resolveOld(response({ projects: [project(1)], scannedIds: ['project-1'], nextCursor: null })) })
    expect(current.map(p => p.id)).toEqual(['project-2'])
  })
})
