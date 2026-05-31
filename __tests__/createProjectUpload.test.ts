import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject } from '@/lib/createProject'

vi.mock('@/lib/image/compress', () => ({
  compressImageFile: vi.fn(async () => 'data:image/jpeg;base64,compressed'),
}))

vi.mock('@/lib/image/metadata', () => ({
  extractPhotoMetadata: vi.fn(async () => ({ cameraMake: 'CodexCam' })),
}))

describe('createProject upload flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('creates an image project through the backend instead of browser Supabase inserts', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('browser supabase insert should not run')
      }),
    }
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/projects/create')
      return new Response(JSON.stringify({ projectId: 'project-from-api', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['fake image'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await createProject(supabase as never, 'user-1', [file])

    expect(result?.projectId).toBe('project-from-api')
    expect(supabase.from).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('pendingImages') || '[]')).toEqual([
      'data:image/jpeg;base64,compressed',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
