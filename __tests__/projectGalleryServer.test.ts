import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseGalleryCursor, readProjectGalleryPage } from '@/lib/server/project-gallery'

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const row = (index: number) => ({
  id: id(index), title: `Project ${index}`, cover_url: null,
  created_at: '2026-11-13T04:52:06.622102+00:00', updated_at: '2026-11-13T04:59:58+00:00',
})

function database(options: {
  projects?: ReturnType<typeof row>[]
  snapshots?: Array<{ id: string; project_id: string; image_url: string | null; sort_order: number; type?: string }>
  animations?: Array<{ id: string; project_id: string }>
  failSnapshotPage?: number
}) {
  const calls: Array<{ table: string; filters: unknown[][]; range?: number[] }> = []
  const admin = { from: (table: string) => {
    const call = { table, filters: [] as unknown[][], range: undefined as number[] | undefined }
    calls.push(call)
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { call.filters.push(['eq', ...args]); return query },
      or: (...args: unknown[]) => { call.filters.push(['or', ...args]); return query },
      in: (...args: unknown[]) => { call.filters.push(['in', ...args]); return query },
      not: () => query, neq: () => query, order: () => query, limit: () => query,
      range: (start: number, end: number) => { call.range = [start, end]; return query },
      then: (resolve: (result: unknown) => unknown) => {
        const rows = table === 'projects' ? options.projects ?? [row(1)]
          : table === 'snapshots' ? options.snapshots ?? [] : options.animations ?? []
        const start = call.range?.[0] ?? 0
        const error = table === 'snapshots' && options.failSnapshotPage === start
          ? { code: '57014', message: 'statement timeout' } : null
        return Promise.resolve({ data: error ? null : rows.slice(start, call.range ? call.range[1] + 1 : undefined), error }).then(resolve)
      },
    }
    return query
  } } as unknown as SupabaseClient
  return { admin, calls }
}

describe('project gallery server', () => {
  it('excludes empty and text-only projects, keeps images and video-only projects', async () => {
    const { admin, calls } = database({
      projects: [row(4), row(3), row(2), row(1)],
      snapshots: [
        { id: 'blank', project_id: id(1), image_url: null, sort_order: 0 },
        { id: 'image', project_id: id(2), image_url: 'https://example.com/image.jpg', sort_order: 0 },
        { id: 'video', project_id: id(3), image_url: null, type: 'video', sort_order: 0 },
      ],
    })
    const page = await readProjectGalleryPage(admin, 'owner')
    expect(page.projects.map(p => p.id)).toEqual([id(3), id(2)])
    expect(page.projects[0]).toMatchObject({ hasVideo: true, snapshotCount: 1, snapshots: [] })
    expect(page.scannedIds).toEqual([id(4), id(3), id(2), id(1)])
    expect(calls[0].filters).toContainEqual(['eq', 'user_id', 'owner'])
    expect(calls[1].filters).toContainEqual(['in', 'project_id', page.scannedIds])
  })

  it('keeps legacy completed video-only projects', async () => {
    const { admin } = database({ animations: [{ id: 'animation', project_id: id(1) }] })
    const page = await readProjectGalleryPage(admin, 'owner')
    expect(page.projects[0]).toMatchObject({ hasVideo: true, snapshotCount: 0 })
  })

  it('scans past the Data API limit and returns only the newest real thumbnail', async () => {
    const snapshots = Array.from({ length: 1205 }, (_, index) => ({
      id: `snapshot-${index}`, project_id: id(1), image_url: `https://example.com/${index}.jpg`, sort_order: index,
    }))
    snapshots.at(-1)!.image_url = '/video-placeholder.png'
    const { admin, calls } = database({ snapshots })
    const page = await readProjectGalleryPage(admin, 'owner')
    expect(page.projects[0].snapshotCount).toBe(1205)
    expect(page.projects[0].snapshots).toHaveLength(1)
    expect(page.projects[0].snapshots[0].sort_order).toBe(1203)
    expect(calls.filter(c => c.table === 'snapshots').map(c => c.range))
      .toEqual([[0, 499], [500, 999], [1000, 1499]])
  })

  it('rejects a failed snapshot page rather than returning an empty gallery', async () => {
    const { admin } = database({ failSnapshotPage: 0 })
    await expect(readProjectGalleryPage(admin, 'owner')).rejects.toMatchObject({ code: '57014' })
  })

  it('advances past an entirely empty page and preserves timestamp precision and tie-breaker', async () => {
    const { admin, calls } = database({ projects: Array.from({ length: 25 }, (_, i) => row(25 - i)) })
    const page = await readProjectGalleryPage(admin, 'owner')
    expect(page.projects).toEqual([])
    expect(page.scannedIds).toHaveLength(24)
    const cursor = parseGalleryCursor(page.nextCursor!)
    expect(cursor).toEqual({ createdAt: row(2).created_at, id: id(2) })
    await readProjectGalleryPage(admin, 'owner', { cursor })
    expect(calls.findLast(c => c.table === 'projects')!.filters).toContainEqual([
      'or', `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    ])
    expect(() => parseGalleryCursor(Buffer.from(JSON.stringify({ ...cursor, id: 'x),user_id.neq.any' })).toString('base64url'))).toThrow()
  })
})
