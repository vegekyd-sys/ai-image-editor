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
    expect(rendererSource).toContain('evalRemotionJSX(resolvedCode)')
    expect(rendererSource).toContain('resolveDesignImageUrls(design, videoResolved)')
    expect(uploadSource).toContain('evalRemotionJSX(code)')
  })

  it('does not auto-play Remotion compositions when code generation publishes a draft', () => {
    const source = read('src/components/ImageCanvas.tsx')

    expect(source).toContain('start from an explicit user click')
    expect(source).not.toContain('remotionAutoPlayRef')
    expect(source).not.toContain('Mark for auto-play')
  })

  it('normalizes common agent Remotion scope declarations before evaluating code', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const sandboxSource = read('src/remotion/DynamicDesign.tsx')

    expect(evalSource).toContain('(?:window\\.)?Remotion')
    expect(evalSource).toContain('window\\.Remotion\\.')
    expect(evalSource).toContain('Remotion\\.')

    expect(sandboxSource).toContain('(?:window\\.)?Remotion')
    expect(sandboxSource).toContain('window\\.Remotion\\.')
    expect(sandboxSource).toContain('Remotion\\.')
  })

  it('prefers the primary composition instead of the first helper function', () => {
    const evalSource = read('src/lib/evalRemotionJSX.ts')
    const sandboxSource = read('src/remotion/DynamicDesign.tsx')
    const serverSource = read('src/lib/remotion-server.ts')

    expect(evalSource).toContain("const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene']")
    expect(evalSource).toContain("return names[names.length - 1] || 'Design'")

    expect(sandboxSource).toContain("const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene']")
    expect(sandboxSource).toContain("return names[names.length - 1] || 'Design'")

    expect(serverSource).toContain('prepareRemotionCodeForSandbox(resolvedDesign.code)')
    expect(serverSource).toContain('resolveRemoteImagesForSandbox(design)')
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
