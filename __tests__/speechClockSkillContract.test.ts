import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const sharedPath = 'skills/_shared/speech-clock.md'

describe('shared Speech Clock skill contract', () => {
  it('routes generated narration and talking-head source speech through one contract', () => {
    const talkingHead = read('src/skills/talking-head/SKILL.md')
    const tiktokAudio = read('src/skills/tiktok-video/references/audio-sync.md')
    const composition = read('src/lib/prompts/remotion-composition.md')

    expect(talkingHead).toContain(sharedPath)
    expect(tiktokAudio).toContain(sharedPath)
    expect(composition).toContain(sharedPath)
  })

  it('defines one measured ASR clock with route-specific mappings', () => {
    const shared = read(`src/${sharedPath}`)
    const normalized = shared.replace(/\s+/g, ' ')

    expect(shared).toContain('call `transcribe_audio` once')
    expect(shared).toContain('audio derivative to ASR')
    expect(normalized).toContain('only speech clock')
    expect(shared).toContain('identity map')
    expect(shared).toContain('{ sourceStart, sourceEnd, outputStart, playbackRate }')
    expect(shared).toContain('outputTime = outputStart + (sourceTime - sourceStart) / playbackRate')
    expect(shared).toContain('Never maintain separate cut, caption, B-roll, or animation clocks')
    expect(shared).toContain('Inspect the encoded MP4')
  })
})
