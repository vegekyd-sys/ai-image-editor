import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('independent video translation skill', () => {
  it('routes VO and talking-head translation without mixing providers', () => {
    const talkingHead = read('src/skills/talking-head/SKILL.md')
    const localization = read('src/skills/localization-dub/SKILL.md')
    const translation = read('src/skills/video-translate/SKILL.md')
    const shared = read('src/skills/_shared/voice-translation.md')

    expect(talkingHead).toContain('generate_audio')
    expect(talkingHead).toContain('skills/video-translate/SKILL.md')
    expect(localization).toContain('skills/video-translate/SKILL.md')
    expect(translation).toContain('userSelectable: true')
    expect(translation).toContain('manifestVisible: true')
    expect(translation).toContain('Non-talking-head or off-screen VO: Seed Audio')
    expect(translation).toContain('Visible talking head: SeeDance 2.0')
    expect(translation).toContain('Do not\ncall Seed Audio anywhere in this route')
    expect(translation).toContain('finish the Talking Head keep-range edit first')
    expect(translation).toContain('Captions and B-roll come after the translated speech')
    expect(translation).toContain('`seedance-fast`')
    expect(translation).toContain('<<<video_1>>>')
    expect(translation).toContain('<<<audio_1>>>')
    expect(translation).toContain('dialogue directly inside the `Shot` as quoted speech')
    expect(translation).toContain('Add one `completion_actions` entry')
    expect(translation).toContain('Never end with only a prose promise to continue')
    expect(shared).toContain('`kind: "translation"`')
    expect(shared).toContain('A visible talking head is edited first by Talking Head')
    expect(shared).toContain('Seed Audio must not be used in that route')
    expect(shared).toContain('translated ASR words')
    expect(shared).toContain('Add B-roll only after translation')
  })
})
