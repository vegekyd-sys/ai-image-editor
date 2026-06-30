import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadAsset } from '@/lib/editor/download'
import { exportDesignVideo } from '@/components/RemotionRenderer'
import type { Snapshot } from '@/types'

vi.mock('@/components/RemotionRenderer', () => ({
  exportDesignVideo: vi.fn(),
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

describe('downloadAsset animated Remotion Save', () => {
  const objectUrl = 'blob:browser-rendered-video'
  let fetchMock: ReturnType<typeof vi.fn>
  let clicked = false
  let clickedHref = ''
  let resolveExport: ((blob: Blob) => void) | undefined

  beforeEach(() => {
    clicked = false
    clickedHref = ''
    fetchMock = vi.fn(async () => {
      throw new Error('frontend Save should not call the backend Remotion export API')
    })
    resolveExport = undefined
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = true
      clickedHref = this.href
    })
    vi.mocked(exportDesignVideo).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps top-right Save on browser-side Remotion export and downloads the MP4 blob', async () => {
    vi.mocked(exportDesignVideo).mockImplementation(async (_design, onProgress) => {
      onProgress?.({ progress: 0.42, encodedFrames: 50, renderedFrames: 50 } as never)
      return new Blob(['mp4-bytes'], { type: 'video/mp4' })
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
    })

    expect(exportDesignVideo).toHaveBeenCalledWith(animatedSnapshot.design, expect.any(Function))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/remotion/export', expect.anything())
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/remotion/export'))).toBe(false)
    expect(clicked).toBe(true)
    expect(clickedHref).toBe(objectUrl)
    expect(setIsSaving).toHaveBeenNthCalledWith(1, true)
    expect(setIsSaving).toHaveBeenLastCalledWith(false)
    expect(setAgentStatus).toHaveBeenCalledWith('Exporting video...')
    expect(setAgentStatus).toHaveBeenCalledWith('Exporting video... 42%')
    expect(setAgentStatus).toHaveBeenCalledWith('editor.done')
    expect(showSaveToast).toHaveBeenCalled()
  })

  it('keeps Save busy while browser-side Remotion export is still rendering', async () => {
    vi.mocked(exportDesignVideo).mockImplementation(() => new Promise<Blob>((resolve) => {
      resolveExport = resolve
    }))
    const setIsSaving = vi.fn()
    const setAgentStatus = vi.fn()
    const showSaveToast = vi.fn()

    const promise = downloadAsset({
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
    })

    await vi.waitFor(() => expect(resolveExport).toBeTruthy())
    expect(setIsSaving).toHaveBeenCalledWith(true)
    expect(setIsSaving).not.toHaveBeenCalledWith(false)
    expect(setAgentStatus).toHaveBeenCalledWith('Exporting video...')

    expect(resolveExport).toBeDefined()
    resolveExport!(new Blob(['mp4-bytes'], { type: 'video/mp4' }))
    await promise
    expect(setIsSaving).toHaveBeenLastCalledWith(false)
    expect(clickedHref).toBe(objectUrl)
    expect(showSaveToast).toHaveBeenCalled()
  })
})
