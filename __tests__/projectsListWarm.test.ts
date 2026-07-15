import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cached: null as unknown[] | null,
  rows: [] as Array<{
    id: string
    title: string
    cover_url: string | null
    updated_at: string
    created_at: string
  }>,
  written: null as { userId: string; projects: unknown[] } | null,
  tables: [] as string[],
}))

vi.mock('@/lib/imageCache', () => ({
  getCachedProjectsListSync: () => state.cached,
  cacheProjectsList: (userId: string, projects: unknown[]) => {
    state.written = { userId, projects }
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tables.push(table)
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        then: (
          resolve: (value: { data: typeof state.rows; error: null }) => void,
          reject: (reason?: unknown) => void,
        ) => Promise.resolve({ data: state.rows, error: null }).then(resolve, reject),
      }
      return query
    },
  }),
}))

import { warmProjectsListCache } from '@/lib/projects-list-warm'

const row = {
  id: 'project-1',
  title: 'Project',
  cover_url: 'https://cdn.makaron.app/cover.jpg',
  updated_at: '2026-07-15T00:00:00.000Z',
  created_at: '2026-07-14T00:00:00.000Z',
}

describe('projects list navigation warmup', () => {
  beforeEach(() => {
    state.cached = null
    state.rows = [row]
    state.written = null
    state.tables = []
  })

  it('preserves a fresh rich snapshot list and video badge', async () => {
    const snapshots = [
      { id: 'snap-1', image_url: 'https://cdn.makaron.app/one.jpg', sort_order: 0 },
      { id: 'snap-2', image_url: 'https://cdn.makaron.app/two.jpg', sort_order: 1 },
    ]
    state.cached = [{ ...row, snapshots, hasVideo: true }]

    await warmProjectsListCache('user-1')

    expect(state.tables).toEqual(['projects'])
    expect(state.written).toEqual({
      userId: 'user-1',
      projects: [{ ...row, snapshots, hasVideo: true }],
    })
  })

  it('treats a synthetic cover row as thin and refreshes its cover', async () => {
    state.cached = [{
      ...row,
      cover_url: 'https://cdn.makaron.app/old-cover.jpg',
      snapshots: [{
        id: 'cover:project-1',
        image_url: 'https://cdn.makaron.app/old-cover.jpg',
        sort_order: 0,
      }],
      hasVideo: true,
    }]

    await warmProjectsListCache('user-1')

    expect(state.written).toEqual({
      userId: 'user-1',
      projects: [{
        ...row,
        snapshots: [{
          id: 'cover:project-1',
          image_url: row.cover_url,
          sort_order: 0,
        }],
        hasVideo: true,
      }],
    })
  })
})
