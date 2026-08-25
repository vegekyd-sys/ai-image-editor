import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, createProjectFromStagedMedia } from '@/lib/createProject'
import { uploadImage } from '@/lib/supabase/storage'
import {
  beginCreateDraftContinuation,
  cacheCreateDraft,
  clearCreateDraft,
  clearPendingProjectLaunches,
  getCreateDraft,
  getCreateDraftContinuationId,
  getCachedProjectDataSync,
  getPendingProjectImagesSync,
  getPendingProjectLaunchSync,
  shouldConsumeCreateDraft,
} from '@/lib/imageCache'

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
    clearPendingProjectLaunches()
    vi.restoreAllMocks()
    vi.mocked(uploadImage).mockImplementation(async (_supabase, _userId, projectId, filename) =>
      `https://cdn.makaron.app/${projectId}/${filename}`)
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
    expect(getPendingProjectImagesSync('project-from-api')).toEqual([
      expect.stringMatching(/^https:\/\/cdn\.makaron\.app\/project-from-api\/snapshot-/),
    ])
    expect(sessionStorage.getItem('pendingImages')).toBeNull()
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
      const body = JSON.parse(String(init?.body))
      if (body._addToProject) {
        expect(body).toMatchObject({
          _addToProject: '11111111-1111-4111-8111-111111111111',
          imageUrls: ['https://cdn.makaron.app/11111111-1111-4111-8111-111111111111/anonymous-source-0.jpg'],
        })
        return new Response(JSON.stringify({
          snapshots: [{
            snapshotId: 'snapshot-from-api',
            imageUrl: body.imageUrls[0],
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      expect(body).toMatchObject({
        title: 'Untitled',
        clientProjectId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'continuation-1',
        skillId: 'installed-skill',
        hasPrompt: true,
      })
      return new Response(JSON.stringify({ projectId: '11111111-1111-4111-8111-111111111111', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createProjectFromStagedMedia(supabase as never, 'user-1', {
      images: ['data:image/jpeg;base64,restored'],
      projectId: '11111111-1111-4111-8111-111111111111',
      continuationId: 'continuation-1',
      metadata: { location: 'Draft City' },
      prompt: 'make it cinematic',
      skill: 'installed-skill',
    })

    expect(result?.projectId).toBe('11111111-1111-4111-8111-111111111111')
    expect(supabase.from).not.toHaveBeenCalled()
    expect(getPendingProjectImagesSync('11111111-1111-4111-8111-111111111111')).toBeNull()
    expect(getCachedProjectDataSync('11111111-1111-4111-8111-111111111111')?.snapshots).toEqual([
      expect.objectContaining({
        id: 'snapshot-from-api',
        imageUrl: 'https://cdn.makaron.app/11111111-1111-4111-8111-111111111111/anonymous-source-0.jpg',
      }),
    ])
    expect(sessionStorage.getItem('pendingImages')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('pendingMetadata') || '{}')).toEqual({ location: 'Draft City' })
    expect(sessionStorage.getItem('pendingPrompt')).toBe('make it cinematic')
    expect(sessionStorage.getItem('pendingSkill')).toBe('installed-skill')
    expect(getPendingProjectLaunchSync('11111111-1111-4111-8111-111111111111')).toMatchObject({
      projectId: '11111111-1111-4111-8111-111111111111',
      prompt: 'make it cinematic',
      skill: 'installed-skill',
      metadata: { location: 'Draft City' },
    })
  })

  it('uploads a restored anonymous draft before creating its visible project shell', async () => {
    const sequence: string[] = []
    vi.mocked(uploadImage).mockImplementationOnce(async (_supabase, _userId, projectId, filename) => {
      sequence.push('upload')
      return `https://cdn.makaron.app/${projectId}/${filename}`
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/marketing/events') return new Response('{}', { status: 200 })
      const body = JSON.parse(String(init?.body))
      if (body._addToProject) {
        sequence.push('persist')
        expect(body).toMatchObject({
          _addToProject: '22222222-2222-4222-8222-222222222222',
          imageUrls: ['https://cdn.makaron.app/22222222-2222-4222-8222-222222222222/anonymous-source-0.jpg'],
        })
        return new Response(JSON.stringify({
          snapshots: [{ snapshotId: 'snapshot-from-api', imageUrl: body.imageUrls[0] }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      sequence.push('create')
      expect(body).toMatchObject({
        clientProjectId: '22222222-2222-4222-8222-222222222222',
        idempotencyKey: 'continuation-2',
      })
      return new Response(JSON.stringify({
        projectId: '22222222-2222-4222-8222-222222222222',
        snapshots: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createProjectFromStagedMedia({} as never, 'user-1', {
      images: ['data:image/jpeg;base64,restored'],
      projectId: '22222222-2222-4222-8222-222222222222',
      continuationId: 'continuation-2',
    })

    expect(sequence).toEqual(['upload', 'create', 'persist'])
  })

  it('does not create an empty project when restored anonymous media upload fails', async () => {
    vi.mocked(uploadImage).mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createProjectFromStagedMedia({} as never, 'user-1', {
      images: ['data:image/jpeg;base64,broken'],
      projectId: '33333333-3333-4333-8333-333333333333',
      continuationId: 'continuation-3',
    })).rejects.toThrow('Failed to upload image')

    expect(fetchMock).not.toHaveBeenCalledWith('/api/projects/create', expect.anything())
  })

  it('binds a text-only prompt to its project so mobile editor remounts cannot lose CUI entry', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/marketing/events') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ projectId: 'text-project', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createProject({} as never, 'user-1', [], {
      prompt: 'turn this into a launch video',
      skill: 'video-maker',
      skillLaunchContext: {
        source: 'home-skill-template',
        homeSkillId: 'home-video-skill',
        skillName: 'video-maker',
        intent: 'complete-result',
      },
    })

    expect(result?.projectId).toBe('text-project')
    expect(getPendingProjectLaunchSync('text-project')).toMatchObject({
      projectId: 'text-project',
      prompt: 'turn this into a launch video',
      skill: 'video-maker',
      skillLaunchContext: {
        source: 'home-skill-template',
        homeSkillId: 'home-video-skill',
        skillName: 'video-maker',
        intent: 'complete-result',
      },
    })
  })

  it('stages multiple images outside sessionStorage so iOS WebView quota cannot strand creation', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/marketing/events') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ projectId: 'multi-project', snapshots: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const originalSetItem = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'pendingImages') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      originalSetItem(key, value)
    })

    const files = [
      new File(['iphone photo 1'], 'IMG_0001.HEIC', { type: 'image/heic' }),
      new File(['iphone photo 2'], 'IMG_0002.HEIC', { type: 'image/heic' }),
    ]
    const result = await createProject({} as never, 'user-1', files)

    expect(result?.projectId).toBe('multi-project')
    expect(getPendingProjectImagesSync('multi-project')).toEqual([
      expect.stringMatching(/^https:\/\/cdn\.makaron\.app\/multi-project\/snapshot-/),
      expect.stringMatching(/^https:\/\/cdn\.makaron\.app\/multi-project\/snapshot-/),
    ])
    expect(sessionStorage.getItem('pendingImages')).toBeNull()
  })

  it('round-trips and clears the anonymous create draft cache', async () => {
    await clearCreateDraft()

    cacheCreateDraft({
      images: ['data:image/jpeg;base64,draft'],
      prompt: 'try this skill',
      homeSkillId: 'home-skill-id',
      skillLaunchContext: {
        source: 'home-skill-template',
        homeSkillId: 'home-skill-id',
        skillName: 'installed-home-skill',
        intent: 'complete-result',
      },
      returnPath: '/home/home-skill-id',
    })

    await expect(getCreateDraft()).resolves.toMatchObject({
      images: ['data:image/jpeg;base64,draft'],
      projectId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      prompt: 'try this skill',
      homeSkillId: 'home-skill-id',
      skillLaunchContext: {
        source: 'home-skill-template',
        homeSkillId: 'home-skill-id',
        skillName: 'installed-home-skill',
        intent: 'complete-result',
      },
      returnPath: '/home/home-skill-id',
    })

    await clearCreateDraft()
    await expect(getCreateDraft()).resolves.toBeNull()
  })

  it('requires an explicit matching continuation before an authenticated home page can consume a draft', async () => {
    cacheCreateDraft({
      images: ['data:image/jpeg;base64,stale'],
      prompt: 'old draft',
      returnPath: '/home/old-skill',
    })
    expect(getCreateDraftContinuationId()).toBeNull()
    expect(shouldConsumeCreateDraft(await getCreateDraft(), getCreateDraftContinuationId())).toBe(false)

    const continuationId = beginCreateDraftContinuation()
    cacheCreateDraft({
      images: ['data:image/jpeg;base64,current'],
      continuationId,
      prompt: 'current draft',
      returnPath: '/home/current-skill',
    })

    expect(getCreateDraftContinuationId()).toBe(continuationId)
    const draft = await getCreateDraft()
    expect(draft).toMatchObject({ continuationId })
    expect(shouldConsumeCreateDraft(draft, continuationId)).toBe(true)
    await clearCreateDraft()
    expect(getCreateDraftContinuationId()).toBeNull()
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
    expect(getPendingProjectImagesSync('large-image-project')).toEqual([
      expect.stringMatching(/^https:\/\/cdn\.makaron\.app\/large-image-project\/snapshot-/),
      expect.stringMatching(/^https:\/\/cdn\.makaron\.app\/large-image-project\/snapshot-/),
    ])
    expect(sessionStorage.getItem('pendingImages')).toBeNull()
  })
})
