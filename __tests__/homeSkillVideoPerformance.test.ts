import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('home skill video performance guardrails', () => {
  it('never downloads complete home skill videos during startup warmup', () => {
    const warmSource = fs.readFileSync(path.join(root, 'src/lib/home-skills-warm.ts'), 'utf8')

    expect(warmSource).not.toContain('cacheMediaUrl')
    expect(warmSource).not.toContain('warmHomeVideoPoster')
    expect(warmSource).toContain('if (isVideoUrl(url))')
    expect(warmSource).toContain('continue')
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
    expect(homePage).toContain('homeSkills.slice(0, visibleSkillCount)')
    expect(homePage).toContain('{shouldAttach && (')
    expect(homePage).not.toContain('useCachedVideoSource')
    expect(homePage).toContain('INITIAL_SKILL_CARD_COUNT = 12')
    expect(homePage).toContain('useHomeVideoPoster(src, false)')
  })

  it('persists generated home video posters through the IndexedDB media cache', () => {
    const posterSource = fs.readFileSync(path.join(root, 'src/lib/home-video-poster.ts'), 'utf8')
    const imageCacheSource = fs.readFileSync(path.join(root, 'src/lib/imageCache.ts'), 'utf8')

    expect(posterSource).toContain('cacheMediaBlob')
    expect(posterSource).toContain('getCachedMediaObjectUrl')
    expect(posterSource).toContain("const POSTER_PREFIX = 'media:home-video-poster:'")
    expect(posterSource).not.toContain('cacheMediaUrl')
    expect(posterSource).not.toContain('mediaCacheKeyForUrl')
    expect(posterSource).not.toContain('sessionStorage')
    expect(posterSource).not.toContain('toDataURL')
    expect(imageCacheSource).toContain('export async function cacheMediaBlob')
    expect(imageCacheSource).toContain("const MEDIA_BLOB_STORE = 'media-blobs'")
  })
})
