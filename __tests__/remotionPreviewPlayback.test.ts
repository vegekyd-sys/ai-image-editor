import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { prepareRemotionCodeForSandbox } from '@/lib/remotion-server'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('Remotion preview playback contract', () => {
  it('keeps the media runtime that supports Remotion playback and export', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const rendererSource = read('src/components/RemotionRenderer.tsx')
    const uploadSource = read('src/lib/video-upload.ts')

    expect(evalSource).toContain("import { Audio, Video } from '@remotion/media'")
    expect(evalSource).toContain('Audio, Video')
    expect(evalSource).toContain('Sequence: AutoPremountSequence')
    expect(evalSource).toContain('normalizeRemotionScopeDeclarations(code)')
    expect(evalSource).toContain('pickRemotionComponentName(src)')

    expect(rendererSource).toContain('player?.pause()')
    expect(rendererSource).toContain('evalRemotionJSX(prepared.code, {')
    expect(rendererSource).toContain("editableTransformMode: 'proxy'")
    expect(rendererSource).toContain("videoRuntime: source === 'player' ? 'preview' : 'render'")
    expect(evalSource).toContain("export type BrowserVideoRuntime = 'preview' | 'render'")
    expect(evalSource).toContain("const isPreviewRuntime = options.videoRuntime === 'preview'")
    expect(evalSource).toContain('? PreviewVideo')
    expect(evalSource).toContain('createEditableReactRuntime(React, videoComponent)')
    expect(evalSource).toContain('Video: videoComponent')
    expect(evalSource).toContain('OffthreadVideo: videoComponent')
    expect(evalSource).toContain('Sequence: isPreviewRuntime ? PreviewSequence : AutoPremountSequence')
    expect(evalSource).toContain('onCanPlay: handleCanPlay')
    expect(evalSource).toContain('onLoadedData: handleLoadedData')
    expect(evalSource).toContain('video.currentTime < minimumRevealTime')
    expect(evalSource).toContain('(containsVideo && (props.from ?? 0) > 0)')
    expect(evalSource).toContain('authoredDuration + continuityFrames')
    expect(evalSource).toContain('(rangeEnd - rangeStart) / playbackRate')
    expect(evalSource).toContain('Math.min(authoredDuration, mediaDuration ?? authoredDuration)')
    expect(evalSource).toContain("crossOrigin: crossOrigin ?? 'anonymous'")
    expect(evalSource).toContain("React.createElement('canvas'")
    expect(evalSource).toContain('video.requestVideoFrameCallback(captureNextFrame)')
    expect(evalSource).toContain('Math.max(1, Math.round(fps / 15))')
    expect(evalSource).toContain('Math.max(2, Math.round(fps * 0.3))')
    expect(evalSource).toContain('lastRealMediaFrameBoundary - showLeadFrames')
    expect(evalSource).toContain('showLastFrameAt - captureLeadFrames')
    expect(evalSource).toContain("position: 'absolute'")
    expect(evalSource).toContain('display: readiness?.showLastFrame')
    expect(evalSource).not.toContain('if (readiness.showLastFrame) return')
    expect(evalSource).toContain('PremountedPostmountedSequence forces its active wrapper opacity back to 1')
    expect(evalSource).toContain('Remotion.AbsoluteFill')
    expect(evalSource).toContain('opacity: mediaReady ? 1 : 0')
    expect(evalSource).toContain('postmountFor: canHoldLastFrame ? 0 : props.postmountFor')
    expect(rendererSource).not.toContain('EditableSceneBoundary')
    expect(rendererSource).toContain('resolveDesignImageUrls(design, videoResolved)')
    expect(rendererSource).not.toContain('frameRange: durationInFrames')
    expect(rendererSource).not.toContain('Skip first/last 3 frames')
    expect(uploadSource).toContain('evalRemotionJSX(code)')
  })

  it('lets a GUI trim override the authored initial video trim', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const runtimeSource = read('src/lib/editor/editable-react-runtime.ts')
    const dynamicDesignSource = read('src/remotion/DynamicDesign.tsx')

    expect(runtimeSource).toContain(
      "trim.trimBefore !== undefined ? { trimBefore: trim.trimBefore } : {}",
    )
    expect(runtimeSource).toContain(
      "trim.trimAfter !== undefined ? { trimAfter: trim.trimAfter } : {}",
    )
    expect(runtimeSource).not.toContain('currentProps.trimBefore === undefined')
    expect(runtimeSource).not.toContain('currentProps.trimAfter === undefined')
    expect(evalSource).toContain('createEditableReactRuntime(React, videoComponent)')
    expect(dynamicDesignSource).toContain('createEditableReactRuntime(')
  })

  it('uses the real off-thread decoder for deterministic server previews', () => {
    const sandboxSource = read('src/remotion/DynamicDesign.tsx')
    const serverSource = read('src/lib/remotion-server.ts')
    const localRendererSource = read('src/lib/remotion-local-renderer.ts')

    expect(sandboxSource).toContain('OffthreadVideo: serverRendering ? serverVideo : MediaVideo')
    expect(serverSource).toContain('useOffthreadVideo: true')
    expect(sandboxSource).toContain("from '../lib/remotion-code-normalization'")
    expect(sandboxSource).not.toContain("from '@/lib/remotion-code-normalization'")
    expect(localRendererSource).toContain("process.env.TMPDIR || '/tmp'")
    expect(localRendererSource).not.toContain("path.join(process.cwd(), '.remotion-bundle-local')")
  })

  it('does not auto-play Remotion compositions when code generation publishes a draft', () => {
    const source = read('src/components/ImageCanvas.tsx')

    expect(source).toContain('start from an explicit user click')
    expect(source).not.toContain('remotionAutoPlayRef')
    expect(source).not.toContain('Mark for auto-play')
  })

  it('lets Remotion own buffering without explicitly pausing the player', () => {
    const source = read('src/components/ImageCanvas.tsx')
    const waitingStart = source.indexOf('const onWaiting = () => {')
    const resumeStart = source.indexOf('const onResume = () => {', waitingStart)
    const waitingHandler = source.slice(waitingStart, resumeStart)

    expect(waitingStart).toBeGreaterThan(-1)
    expect(waitingHandler).toContain('setRemotionBuffering(true)')
    expect(waitingHandler).not.toContain('player.pause()')
    expect(source).toContain("player.addEventListener('resume', onResume)")
  })

  it('updates interactive input props without recompiling the composition', () => {
    const rendererSource = read('src/components/RemotionRenderer.tsx')

    expect(rendererSource).toContain('const designPropsRef = useRef(design.props || {})')
    expect(rendererSource).toContain('designPropsRef.current = design.props || {}')
    expect(rendererSource).toContain('design.fontSubstitutions, retryToken]')
    expect(rendererSource).toContain('}, [design.props])')
    expect(rendererSource).not.toContain('}, [design.code, design.fontSubstitutions, design.props])')
  })

  it('degrades only browser preview fonts when a resource load fails', () => {
    const rendererSource = read('src/components/RemotionRenderer.tsx')

    expect(rendererSource).toContain('compileBrowserDesignWithoutPinnedFonts')
    expect(rendererSource).toContain('isRecoverableRemotionPreviewError')
    expect(rendererSource).toContain("reportPreviewFailureRef.current('font-load'")
    expect(rendererSource).toContain('recovered: true')
    expect(rendererSource).not.toContain('Render error: {error.message}')
  })

  it('normalizes common agent Remotion scope declarations before evaluating code', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const sandboxSource = read('src/remotion/DynamicDesign.tsx')
    const normalizationSource = read('src/lib/remotion-code-normalization.ts')

    expect(evalSource).toContain('(?:window\\.)?Remotion')
    expect(evalSource).toContain('window\\.Remotion\\.')
    expect(evalSource).toContain('Remotion\\.')

    expect(sandboxSource).toContain('normalizeRemotionScopeDeclarations')
    expect(normalizationSource).toContain('(?:window\\.)?Remotion')
    expect(normalizationSource).toContain('window\\.Remotion\\.')
    expect(normalizationSource).toContain('Remotion\\.')
  })

  it('prefers the primary composition instead of the first helper function', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const sandboxSource = read('src/remotion/DynamicDesign.tsx')
    const serverSource = read('src/lib/remotion-server.ts')

    expect(evalSource).toContain("const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene']")
    expect(evalSource).toContain("return names[names.length - 1] || 'Design'")

    expect(sandboxSource).toContain("const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene']")
    expect(sandboxSource).toContain("return names[names.length - 1] || 'Design'")

    expect(serverSource).toContain('prepareRemotionCodeForSandbox(design.code)')
    expect(serverSource).toContain('designProps: design.props || {}')
    expect(serverSource).not.toContain('remoteImageToDataUrl')
    expect(serverSource).not.toContain('resolveRemoteImagesForSandbox')
  })

  it('wraps helper-first code for the existing sandbox snapshot evaluator', () => {
    const prepared = prepareRemotionCodeForSandbox(`
      const { AbsoluteFill, Video } = window.Remotion;
      function Caption(props) {
        return <div>{props.text}</div>;
      }
      function DevLogComposition(props) {
        return <AbsoluteFill><Caption text={props.title} /></AbsoluteFill>;
      }
    `)

    expect(prepared).toMatch(/^function Design\(props\)/)
    expect(prepared).toContain('React.createElement(DevLogComposition, props)')
    expect(prepared).not.toContain('window.Remotion')
    expect(prepared).not.toContain('const { AbsoluteFill, Video }')
  })
})
