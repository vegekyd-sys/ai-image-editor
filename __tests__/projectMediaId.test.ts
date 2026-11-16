import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticate: vi.fn(),
  publish: vi.fn(),
  from: vi.fn(),
  project: { data: { id: 'project' }, error: null } as {
    data: { id: string } | null; error: { code: string; message: string } | null
  },
}))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: state.authenticate }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: vi.fn() }))
vi.mock('@/lib/external-video-range', () => ({ publishExternalVideoRanges: state.publish }))
import { POST } from '@/app/api/projects/[id]/media/route'

const projectId = '12345678-1234-4234-8234-123456789abc'
const client = { from: state.from }
const clips = [{ source_url: 'https://example.com/source.mp4', start: 1, end: 3, description: 'Clip' }]
function post(id: string) {
  return POST(new NextRequest('https://example.com/api/projects/project/media', {
    method: 'POST', body: JSON.stringify({ clips }),
  }), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.project = { data: { id: projectId }, error: null }
  state.authenticate.mockResolvedValue({ auth: { userId: 'owner', supabase: client } })
  state.publish.mockReset().mockResolvedValue([])
  state.from.mockImplementation(() => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => state.project) }
    return query
  })
})

describe('project media publication identifiers', () => {
  it.each(['prj_00000000000000000000000000000000', 'not-a-project', '', `${projectId}x`])(
    'returns 400 for malformed ID %s after a UUID parse error without publishing', async id => {
      state.project = { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }
      const response = await post(id)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid project ID' })
      expect(state.from).toHaveBeenCalledWith('projects')
      expect(state.publish).not.toHaveBeenCalled()
    },
  )

  it('keeps authentication failures ahead of the project lookup', async () => {
    state.authenticate.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await post('prj_invalid')).status).toBe(401)
    expect(state.from).not.toHaveBeenCalled()
    expect(state.publish).not.toHaveBeenCalled()
  })

  it.each([projectId, projectId.toUpperCase(), '12345678-1234-7234-8234-123456789abc',
    projectId.replaceAll('-', ''), `{${projectId}}`])(
    'preserves publication for owned UUID %s', async id => {
      const response = await post(id)
      expect(response.status).toBe(201)
      expect(state.publish).toHaveBeenCalledWith({ supabase: client, projectId: id, userId: 'owner', ranges: clips })
    },
  )

  it('keeps missing or unowned valid projects unpublished', async () => {
    state.project.data = null
    expect((await post(projectId)).status).toBe(404)
    expect(state.publish).not.toHaveBeenCalled()
  })

  it('preserves real database failures for valid IDs', async () => {
    state.project = { data: null, error: { code: '57014', message: 'statement timeout' } }
    expect((await post(projectId)).status).toBe(500)
    expect(state.publish).not.toHaveBeenCalled()
  })

  it('keeps source-range validation errors as client errors', async () => {
    state.publish.mockRejectedValue(new Error('source range end must be greater than start'))
    expect((await post(projectId)).status).toBe(400)
  })
})
