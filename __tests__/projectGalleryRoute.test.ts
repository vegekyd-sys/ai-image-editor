import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'verified-owner' } as { id: string } | null,
  authError: null as unknown,
  read: vi.fn(),
  admin: {},
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: state.user }, error: state.authError }),
} }) }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => state.admin }))
vi.mock('@/lib/server/project-gallery', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/project-gallery')>(),
  readProjectGalleryPage: state.read,
}))
import { GET } from '@/app/api/projects/gallery/route'

beforeEach(() => {
  state.user = { id: 'verified-owner' }
  state.authError = null
  state.read.mockReset().mockResolvedValue({ projects: [], scannedIds: [], nextCursor: null })
})

describe('project gallery route access', () => {
  it('rejects unverified sessions before accessing admin data', async () => {
    state.authError = new Error('Invalid token')
    const response = await GET(new NextRequest('https://example.com/api/projects/gallery'))
    expect(response.status).toBe(401)
    expect(state.read).not.toHaveBeenCalled()
  })
  it('always uses the verified owner, ignoring a supplied user ID', async () => {
    const response = await GET(new NextRequest('https://example.com/api/projects/gallery?user_id=someone-else'))
    expect(response.status).toBe(200)
    expect(state.read).toHaveBeenCalledWith(state.admin, 'verified-owner', { cursor: undefined, projectId: undefined })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('rejects invalid cursors and project identifiers before querying', async () => {
    for (const params of ['cursor=invalid', 'id=invalid']) {
      const response = await GET(new NextRequest(`https://example.com/api/projects/gallery?${params}`))
      expect(response.status).toBe(400)
    }
    expect(state.read).not.toHaveBeenCalled()
  })
  it('returns a failure response instead of empty projects on a query timeout', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.read.mockRejectedValue({ code: '57014' })
    const response = await GET(new NextRequest('https://example.com/api/projects/gallery'))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('projects')
    log.mockRestore()
  })
})
