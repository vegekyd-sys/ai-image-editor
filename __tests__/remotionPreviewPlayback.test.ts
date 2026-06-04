import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

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

    expect(rendererSource).toContain('player?.pause()')
    expect(rendererSource).toContain('evalRemotionJSX(videoResolved)')
    expect(uploadSource).toContain('evalRemotionJSX(code)')
  })

  it('does not auto-play Remotion compositions when code generation publishes a draft', () => {
    const source = read('src/components/ImageCanvas.tsx')

    expect(source).toContain('start from an explicit user click')
    expect(source).not.toContain('remotionAutoPlayRef')
    expect(source).not.toContain('Mark for auto-play')
  })
})
