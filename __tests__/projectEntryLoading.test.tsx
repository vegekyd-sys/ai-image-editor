import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, reads: [] as string[], uploads: vi.fn(), cache: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  from: (table: string) => {
    const query: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'order', 'in', 'single', 'maybeSingle']) query[name] = () => query
    query.then = (resolve: (value: unknown) => void) => {
      state.reads.push(table)
      return Promise.resolve({ data: state.rows[table] ?? [], error: null }).then(resolve)
    }
    return query
  },
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }), upload: state.uploads }) },
}) }))
vi.mock('@/lib/supabase/storage', () => ({ uploadImage: vi.fn() }))
vi.mock('@/lib/imageCache', () => ({ cacheProjectData: state.cache, getCachedProjectData: vi.fn() }))
vi.mock('@/lib/editor/loaded-design-manifest', () => ({ normalizeLoadedDesignManifest: (design: unknown) => design }))
import { useProject } from '@/hooks/useProject'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
  state.reads = []; state.uploads.mockReset(); state.cache.mockReset()
  state.rows = {
    projects: { user_id: 'owner', is_public: true, title: 'Demo', timeline_version: 2 },
    snapshots: [{ id: 'snap', type: 'design', image_url: 'https://poster.example/image.jpg', design_path: 'project/code/snap.json', message_id: 'message', tips: [] }],
    messages: [{ id: 'message', role: 'assistant', content: 'Design', has_image: true, created_at: '2026-10-01', project_id: 'project' }],
    project_music: [{ status: 'completed', audio_url: 'https://audio.example/song.mp3' }],
  }
})

describe('project entry loading', () => {
  it('returns posters, history, access and music before slow designs, then hydrates linked history', async () => {
    let finish!: (value: Response) => void
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const hydrated = vi.fn()
    const { result } = renderHook(() => useProject('project', 'viewer'))
    let project!: Awaited<ReturnType<typeof result.current.loadProject>>
    await act(async () => { project = await result.current.loadProject(hydrated) })
    expect(project.ownerId).toBe('owner'); expect(project.isPublic).toBe(true)
    expect(project.musicRows).toHaveLength(1)
    expect(project.snapshots[0].image).toContain('poster.example')
    expect(project.snapshots[0].design).toBeUndefined(); expect(hydrated).not.toHaveBeenCalled()
    expect(state.reads).toEqual(['snapshots', 'messages', 'projects', 'agent_events', 'project_music'])
    expect(fetchMock.mock.calls[0][0]).toContain('/owner/workspace/')
    await act(async () => { finish(new Response(JSON.stringify({ code: 'return null', props: { title: 'Restored' } }), { status: 200 })); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(hydrated).toHaveBeenCalledOnce()
    expect(hydrated.mock.calls[0][0][0].design.props.title).toBe('Restored')
    expect(hydrated.mock.calls[0][1][0].design.props.title).toBe('Restored')
    expect(state.uploads).not.toHaveBeenCalled(); expect(state.cache).not.toHaveBeenCalled()
  })

  it('keeps an inaccessible project distinguishable from an empty public project', async () => {
    state.rows.projects = null; state.rows.snapshots = []; state.rows.messages = []
    const { result } = renderHook(() => useProject('private-project', ''))
    const project = await result.current.loadProject()
    expect(project.ownerId).toBeNull(); expect(project.isPublic).toBe(false)
  })

  it('restores legacy animations while loading music in the initial read wave', async () => {
    state.rows.projects = { user_id: 'owner', is_public: true, timeline_version: 1 }
    state.rows.snapshots = []
    state.rows.project_animations = [{ id: 'anim', video_url: 'https://video.example/movie.mp4', status: 'completed' }]
    const { result } = renderHook(() => useProject('project', ''))
    const project = await result.current.loadProject()
    expect(project.animations[0].videoUrl).toContain('movie.mp4')
    expect(state.reads.indexOf('project_music')).toBeLessThan(state.reads.indexOf('project_animations'))
  })
})
