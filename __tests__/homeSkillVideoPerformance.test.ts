import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('home skill video performance guardrails', () => {
  it('warms home skill videos without retaining hidden video decoders', () => {
    const warmSource = fs.readFileSync(path.join(root, 'src/lib/home-skills-warm.ts'), 'utf8')

    expect(warmSource).toContain('void cacheMediaUrl(normalizedUrl)')
    expect(warmSource).toContain('void warmHomeVideoPoster(normalizedUrl)')
    expect(warmSource).not.toContain("document.createElement('video')")
    expect(warmSource).not.toContain('retainedVideos')
    expect(warmSource).not.toContain("video.preload = 'auto'")
  })

  it('detaches inactive home and detail videos so Safari can release media resources', () => {
    const homePage = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8')

    expect(homePage).toContain('useHomeVideoPoster')
    expect(homePage).toContain('videoReady')
    expect(homePage).toContain("onLoadedData={() => setVideoReady(true)}")
    expect(homePage).toContain('suspended?: boolean')
    expect(homePage).toContain('active?: boolean')
    expect(homePage).toContain('const shouldAttach = isNearViewport && !suspended')
    expect(homePage).toContain('const shouldAttach = eager || active')
    expect(homePage).toContain("video.removeAttribute('src')")
    expect(homePage).toContain('preload={shouldAttach ?')
    expect(homePage).toContain('suspended: !!selectedDetail')
    expect(homePage).toContain('active: template.id === selectedDetail?.id')
  })

  it('persists generated home video posters through the IndexedDB media cache', () => {
    const posterSource = fs.readFileSync(path.join(root, 'src/lib/home-video-poster.ts'), 'utf8')
    const imageCacheSource = fs.readFileSync(path.join(root, 'src/lib/imageCache.ts'), 'utf8')

    expect(posterSource).toContain('cacheMediaBlob')
    expect(posterSource).toContain('getCachedMediaObjectUrl')
    expect(posterSource).toContain("const POSTER_PREFIX = 'media:home-video-poster:'")
    expect(posterSource).not.toContain('sessionStorage')
    expect(posterSource).not.toContain('toDataURL')
    expect(imageCacheSource).toContain('export async function cacheMediaBlob')
    expect(imageCacheSource).toContain("const MEDIA_BLOB_STORE = 'media-blobs'")
  })
})
