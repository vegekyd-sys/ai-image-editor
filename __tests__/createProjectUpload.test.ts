import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, createProjectFromStagedMedia } from '@/lib/createProject'
import { cacheCreateDraft, clearCreateDraft, getCreateDraft } from '@/lib/imageCache'

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
    expect(JSON.parse(sessionStorage.getItem('pendingImages') || '[]')).toEqual([
      'data:image/jpeg;base64,compressed',
    ])
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
    expect(JSON.parse(sessionStorage.getItem('pendingImages') || '[]')).toEqual([
      'data:image/jpeg;base64,restored',
    ])
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
})
