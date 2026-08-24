import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('same-speaker talking-head translation contract', () => {
  it('is shared by talking-head and localization workflows', () => {
    const talkingHead = read('src/skills/talking-head/SKILL.md')
    const localization = read('src/skills/localization-dub/SKILL.md')
    const shared = read('src/skills/_shared/voice-translation.md')

    expect(talkingHead).toContain('generate_audio')
    expect(talkingHead).toContain('skills/_shared/voice-translation.md')
    expect(localization).toContain('skills/_shared/voice-translation.md')
    expect(shared).toContain('`kind: "translation"`')
    expect(shared).toContain('source_voice.type: "timeline_media"')
    expect(shared).toContain('Do not send video bytes to Seed Audio')
    expect(shared).toContain('translated ASR words')
    expect(shared).toContain('do not claim\nlip sync')
  })
})
