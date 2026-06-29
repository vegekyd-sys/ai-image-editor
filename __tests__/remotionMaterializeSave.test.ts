import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadAsset } from '@/lib/editor/download'
import type { Snapshot } from '@/types'

vi.mock('@/components/RemotionRenderer', () => ({
  exportDesignVideo: vi.fn(() => {
    throw new Error('browser-side Remotion export should not be used')
  }),
}))

const animatedSnapshot: Snapshot = {
  id: 'snap_comp_1',
  image: 'poster',
  tips: [],
  messageId: 'msg_1',
  designPath: 'project-1/code/snap_comp_1.json',
  design: {
    width: 1080,
    height: 1920,
    animation: { fps: 30, durationInSeconds: 4 },
    props: { title: 'Save test' },
    code: 'function Composition(){ return <AbsoluteFill />; }',
  },
}

describe('downloadAsset Remotion materialization', () => {
  const objectUrl = 'blob:materialized-video'
  let fetchMock: ReturnType<typeof vi.fn>
  let clicked = false
  let clickedHref = ''
  let resolvePoll: (() => void) | null = null

  beforeEach(() => {
    clicked = false
    clickedHref = ''
    resolvePoll = null
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/remotion/export') {
        return new Response(JSON.stringify({ id: 'job_1', jobId: 'job_1', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/remotion/export/job_1') {
        return new Response(JSON.stringify({
          id: 'job_1',
          status: 'completed',
          url: 'https://cdn.example/remotion-save.mp4',
          width: 720,
          height: 1280,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/proxy-video?')) {
        return new Response(new Blob(['mp4-bytes'], { type: 'video/mp4' }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method || 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = true
      clickedHref = this.href
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('exports animated designs through the backend worker and downloads the MP4 without creating a snapshot', async () => {
    const setIsSaving = vi.fn()
    const setAgentStatus = vi.fn()
    const showSaveToast = vi.fn()
    const onCreateExportSnapshot = vi.fn()
    const onUpdateExportSnapshot = vi.fn()

    await downloadAsset({
      timeline: ['poster'],
      viewIndex: 0,
      isViewingVideo: false,
      currentVideoUrl: null,
      draftParentIndex: null,
      snapshotsRef: { current: [animatedSnapshot] },
      pendingVideoRef: { current: null },
      setIsSaving,
      setAgentStatus,
      showSaveToast,
      onCreateExportSnapshot,
      onUpdateExportSnapshot,
      t: ((key: string) => key) as never,
      projectTitle: 'Project',
      projectId: 'project-1',
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const createCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/remotion/export')
    expect(createCall).toBeTruthy()
    const body = JSON.parse(String(createCall?.[1]?.body))
    expect(body).toMatchObject({
      projectId: 'project-1',
      snapshotId: 'snap_comp_1',
      designPath: 'project-1/code/snap_comp_1.json',
      outputType: 'video',
      renderProfile: 'fast_720p',
      publish: false,
    })
    expect(body.publishSnapshotId).toBeUndefined()
    expect(body.design.width).toBe(1080)
    expect(onCreateExportSnapshot).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/remotion/export/job_1')
    expect(onUpdateExportSnapshot).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/proxy-video?'))).toBe(false)
    expect(clicked).toBe(true)
    expect(clickedHref).toBe('https://cdn.example/remotion-save.mp4')
    expect(setIsSaving).toHaveBeenLastCalledWith(false)
    expect(setAgentStatus).toHaveBeenCalledWith('Downloading video...')
    expect(setAgentStatus).toHaveBeenCalledWith('editor.done')
    expect(showSaveToast).toHaveBeenCalled()
  })

  it('keeps Save busy while a Remotion export is still rendering', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/remotion/export') {
        return new Response(JSON.stringify({ id: 'job_slow', jobId: 'job_slow', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/remotion/export/job_slow') {
        await new Promise<void>((resolve) => { resolvePoll = resolve })
        return new Response(JSON.stringify({
          id: 'job_slow',
          status: 'completed',
          url: 'https://cdn.example/remotion-save.mp4',
          width: 720,
          height: 1280,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/proxy-video?')) {
        return new Response(new Blob(['mp4-bytes'], { type: 'video/mp4' }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method || 'GET'}`)
    })

    const setIsSaving = vi.fn()
    const setAgentStatus = vi.fn()
    const showSaveToast = vi.fn()

    await downloadAsset({
      timeline: ['poster'],
      viewIndex: 0,
      isViewingVideo: false,
      currentVideoUrl: null,
      draftParentIndex: null,
      snapshotsRef: { current: [animatedSnapshot] },
      pendingVideoRef: { current: null },
      setIsSaving,
      setAgentStatus,
      showSaveToast,
      t: ((key: string) => key) as never,
      projectTitle: 'Project',
      projectId: 'project-1',
    })
    await vi.waitFor(() => expect(resolvePoll).toBeTruthy())

    expect(setIsSaving).toHaveBeenCalledWith(true)
    expect(setIsSaving).not.toHaveBeenCalledWith(false)
    expect(setAgentStatus).toHaveBeenCalledWith('Exporting video...')

    resolvePoll?.()
    await vi.waitFor(() => expect(setIsSaving).toHaveBeenLastCalledWith(false))
    expect(clickedHref).toBe('https://cdn.example/remotion-save.mp4')
    expect(showSaveToast).toHaveBeenCalled()
  })

  it('shows finalizing copy instead of exporting 100 percent while waiting for the download URL', async () => {
    let pollCount = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/remotion/export') {
        return new Response(JSON.stringify({ id: 'job_finalizing', jobId: 'job_finalizing', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/remotion/export/job_finalizing') {
        pollCount += 1
        if (pollCount === 1) {
          return new Response(JSON.stringify({
            id: 'job_finalizing',
            status: 'rendering',
            progress: 1,
            next_poll_after_ms: 1,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({
          id: 'job_finalizing',
          status: 'completed',
          url: 'https://cdn.example/remotion-save.mp4',
          width: 720,
          height: 1280,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/proxy-video?')) {
        return new Response(new Blob(['mp4-bytes'], { type: 'video/mp4' }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method || 'GET'}`)
    })

    const setIsSaving = vi.fn()
    const setAgentStatus = vi.fn()
    const showSaveToast = vi.fn()

    await downloadAsset({
      timeline: ['poster'],
      viewIndex: 0,
      isViewingVideo: false,
      currentVideoUrl: null,
      draftParentIndex: null,
      snapshotsRef: { current: [animatedSnapshot] },
      pendingVideoRef: { current: null },
      setIsSaving,
      setAgentStatus,
      showSaveToast,
      t: ((key: string) => key) as never,
      projectTitle: 'Project',
      projectId: 'project-1',
    })
    await vi.waitFor(() => expect(setAgentStatus).toHaveBeenCalledWith('Preparing download...'))
    expect(setAgentStatus).not.toHaveBeenCalledWith('Exporting video... 100%')
    await vi.waitFor(() => expect(setIsSaving).toHaveBeenLastCalledWith(false))
  })
})
