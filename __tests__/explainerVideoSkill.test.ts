import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseSkillMd } from '../src/lib/skill-registry'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('Explainer Video built-in skill', () => {
  it('uses the current Remotion composition architecture', () => {
    const agent = read('src/lib/prompts/agent.md')
    const rawSkill = read('src/skills/explainer-video/SKILL.md')
    const skill = parseSkillMd(rawSkill)

    expect(skill?.name).toBe('explainer-video')
    expect(skill?.makaron.builtIn).toBe(true)
    expect(skill?.makaron.tags).toContain('explainer')
    expect(skill?.allowedTools).toEqual(expect.arrayContaining([
      'read_file',
      'run_code',
      'write_file',
      'preview_frame',
      'list_voiceover_voices',
      'generate_voiceover',
      'transcribe_audio',
      'generate_image',
    ]))

    expect(rawSkill).toContain('local Remotion composition workflow')
    expect(rawSkill).toContain('not the Open Montage workflow runtime')
    expect(rawSkill).toContain('awesome-design-md')
    expect(rawSkill).toContain('design-md/spacex/DESIGN.md')
    expect(rawSkill).toContain('Target duration: use the user')
    expect(rawSkill).toContain('If missing, make 60s')
    expect(rawSkill).toContain('Voiceover is part of this skill by default')
    expect(rawSkill).toContain('Subtitles are part of this skill by default')
    expect(rawSkill).toContain('Unless the user explicitly requested a silent/text-only video')
    expect(rawSkill).toContain('call `transcribe_audio({ media_url: audioUrl })`')
    expect(rawSkill).toContain('read and follow')
    expect(rawSkill).toContain('skills/sticker-maker/SKILL.md')
    expect(rawSkill).toContain('At least three `preview_frame` checks')
    expect(rawSkill).toContain('The composition is saved and published to the timeline')

    expect(agent).toContain('skills/explainer-video/SKILL.md')
    expect(agent).toContain('Explainer Video')
    expect(agent).toContain('explainer video')
    expect(agent).toContain('local editable composition request, not a long-video provider generation request')
  })
})
