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
})
