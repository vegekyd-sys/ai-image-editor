import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const sharedPath = 'skills/_shared/spoken-caption.md'

describe('shared Spoken Caption skill contract', () => {
  it('is shared by TikTok, talking-head, and the composition contract', () => {
    expect(read('src/skills/tiktok-video/SKILL.md')).toContain(sharedPath)
    expect(read('src/skills/tiktok-video/references/caption-direction.md')).toContain(sharedPath)
    expect(read('src/skills/talking-head/SKILL.md')).toContain(sharedPath)
    expect(read('src/lib/prompts/remotion-composition.md')).toContain(sharedPath)
  })

  it('standardizes caption outcomes without becoming a visual template', () => {
    const shared = read(`src/${sharedPath}`)
    const normalized = shared.replace(/\s+/g, ' ')

    expect(normalized).toContain('shortest natural phrase that still carries one complete semantic beat')
    expect(normalized).toContain('one-glance phone reading')
    expect(normalized).toContain('complete cue exactly once')
    expect(normalized).toContain('shorter by partitioning the retained speech, not by summarizing')
    expect(normalized).toContain('exact substring of that cue')
    expect(shared).toContain('one visible caption host per active cue')
    expect(shared).toContain('final MP4 is the acceptance artifact')
    expect(shared).toContain('There is no shared font, plaque, lower-third')
    expect(shared).toContain('does not provide a renderer or a fixed visual template')
  })

  it('keeps timing in Speech Clock and visual direction in each composition', () => {
    const shared = read(`src/${sharedPath}`)
    const speechClock = read('src/skills/_shared/speech-clock.md')
    const normalizedClock = speechClock.replace(/\s+/g, ' ')
    const tiktokDirection = read('src/skills/tiktok-video/references/caption-direction.md')

    expect(shared).toContain('Read\n`skills/_shared/speech-clock.md` first')
    expect(normalizedClock).toContain('only speech clock')
    expect(tiktokDirection).toContain('only TikTok/Douyin speech and art-direction choices')
    expect(tiktokDirection).toContain('platform-layout.md')
    expect(tiktokDirection).not.toContain('subtitleSyncEvidence')
  })
})
