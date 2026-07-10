import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, createProjectFromStagedMedia } from '@/lib/createProject'
import { cacheCreateDraft, clearCreateDraft, getCreateDraft } from '@/lib/imageCache'

vi.mock('@/lib/supabase/storage', () => ({
  uploadImage: vi.fn(async (_supabase, _userId, projectId: string, filename: string) =>
    `https://cdn.makaron.app/${projectId}/${filename}`),
}))

vi.mock('@/lib/image/compress', () => ({
  compressImageFile: vi.fn(async () => 'data:image/jpeg;base64,compressed'),
}))

vi.mock('@/lib/image/metadata', () => ({
  extractPhotoMetadata: vi.fn(async () => ({ cameraMake: 'CodexCam' })),
}))

describe('createProject upload flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  it('creates an image project through the backend instead of browser Supabase inserts', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('browser supabase insert should not run')
      }),
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/marketing/events') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
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
    const pendingImages = JSON.parse(sessionStorage.getItem('pendingImages') || '[]') as string[]
    expect(pendingImages).toHaveLength(1)
    expect(pendingImages[0]).toMatch(/^https:\/\/cdn\.makaron\.app\/project-from-api\/snapshot-/)
    expect(sessionStorage.getItem('pendingImages')).not.toContain('data:image')
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/create', expect.any(Object))
  })

  it('creates a project from a restored anonymous draft and stages media for the editor', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('browser supabase insert should not run')
      }),
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/marketing/events') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      expect(url).toBe('/api/projects/create')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        title: 'Untitled',
        skillId: 'installed-skill',
        hasPrompt: true,
      })
      return new Response(JSON.stringify({ projectId: 'restored-project', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createProjectFromStagedMedia(supabase as never, 'user-1', {
      images: ['data:image/jpeg;base64,restored'],
      metadata: { location: 'Draft City' },
      prompt: 'make it cinematic',
      skill: 'installed-skill',
    })

    expect(result?.projectId).toBe('restored-project')
    expect(supabase.from).not.toHaveBeenCalled()
    const pendingImages = JSON.parse(sessionStorage.getItem('pendingImages') || '[]') as string[]
    expect(pendingImages).toHaveLength(1)
    expect(pendingImages[0]).toMatch(/^https:\/\/cdn\.makaron\.app\/restored-project\/snapshot-/)
    expect(sessionStorage.getItem('pendingImages')).not.toContain('data:image')
    expect(JSON.parse(sessionStorage.getItem('pendingMetadata') || '{}')).toEqual({ location: 'Draft City' })
    expect(sessionStorage.getItem('pendingPrompt')).toBe('make it cinematic')
    expect(sessionStorage.getItem('pendingSkill')).toBe('installed-skill')
  })

  it('round-trips and clears the anonymous create draft cache', async () => {
    await clearCreateDraft()

    cacheCreateDraft({
      images: ['data:image/jpeg;base64,draft'],
      prompt: 'try this skill',
      homeSkillId: 'home-skill-id',
      returnPath: '/home/home-skill-id',
    })

    await expect(getCreateDraft()).resolves.toMatchObject({
      images: ['data:image/jpeg;base64,draft'],
      prompt: 'try this skill',
      homeSkillId: 'home-skill-id',
      returnPath: '/home/home-skill-id',
    })

    await clearCreateDraft()
    await expect(getCreateDraft()).resolves.toBeNull()
  })

  it('never writes large base64 image payloads into sessionStorage', async () => {
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'pendingImages' && value.includes('data:image')) {
        throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/marketing/events') return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ projectId: 'large-image-project', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const files = [
      new File(['large-a'], 'large-a.jpg', { type: 'image/jpeg' }),
      new File(['large-b'], 'large-b.jpg', { type: 'image/jpeg' }),
    ]
    await expect(createProject({} as never, 'user-1', files)).resolves.toMatchObject({ projectId: 'large-image-project' })

    expect(setItem).not.toHaveBeenCalledWith('pendingImages', expect.stringContaining('data:image'))
    expect(JSON.parse(sessionStorage.getItem('pendingImages') || '[]')).toHaveLength(2)
  })
})
