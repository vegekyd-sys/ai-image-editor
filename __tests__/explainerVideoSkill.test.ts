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
      'generate_audio',
      'generate_image',
    ]))

    expect(rawSkill).toContain('local Remotion composition workflow')
    expect(rawSkill).toContain('not the Open Montage workflow runtime')
    expect(rawSkill).toContain('skills/_shared/remotion-director-contract.md')
    expect(rawSkill).toContain('remotion-video-director')
    expect(rawSkill).toContain('skills/_shared/remotion-video-director/references/video-archetypes.md')
    expect(rawSkill).toContain('skills/_shared/remotion-video-director/references/remotion-patterns.md')
    expect(rawSkill).toContain('skills/_shared/remotion-video-director/references/component-library.md')
    expect(rawSkill).toContain('creative brief')
    expect(rawSkill).toContain('layout contract')
    expect(rawSkill).toContain('Do not reduce it to a color palette or website design system')
    expect(rawSkill).toContain('Target duration: use the user')
    expect(rawSkill).toContain('If missing, make 60s')
    expect(rawSkill).toContain('The requested duration is a hard contract')
    expect(rawSkill).toContain('never change the video duration to match an')
    expect(rawSkill).toContain('Voiceover is part of this skill by default')
    expect(rawSkill).toContain('Subtitles are part of this skill by default')
    expect(rawSkill).toContain('Sound design is part of the planning pass')
    expect(rawSkill).toContain('Use `generate_audio` for prompt-first assets')
    expect(rawSkill).toContain('new music')
    expect(rawSkill).toContain('uses Seed Audio, not Suno')
    expect(rawSkill).not.toContain('provider: "suno"')
    expect(rawSkill).toContain('Audio Index markers such as `<<<audio_N>>>` are labels')
    expect(rawSkill).toContain('Use the returned public `audioUrl` directly in Remotion')
    expect(rawSkill).toContain('Never put `<<<audio_N>>>` inside composition props or `<Audio>`')
    expect(rawSkill).toContain('Create a compact asset-and-audio cue sheet before generating media')
    expect(rawSkill).toContain('Scene -> narration beat -> sound beat -> base Remotion motion')
    expect(rawSkill).toContain('Do not default to webpage structures')
    expect(rawSkill).toContain('Let time solve layout density')
    expect(rawSkill).toContain('Prefer stickers for foreground insertions')
    expect(rawSkill).toContain('Rectangular generated images are')
    expect(rawSkill).toContain('usually 1-3 strong')
    expect(rawSkill).toContain('Never put `<<<media_N>>>` markers inside composition code')
    expect(rawSkill).toContain('Scene Cue Sheet Pattern')
    expect(rawSkill).toContain('All Chinese,')
    expect(rawSkill).toContain('Unexpected identifier')
    expect(rawSkill).toContain('Unless the user explicitly requested a silent/text-only video')
    expect(rawSkill).toContain('call `transcribe_audio({ media_url: audioUrl })`')
    expect(rawSkill).toContain('read and follow')
    expect(rawSkill).toContain('skills/sticker-maker/SKILL.md')
    expect(rawSkill).toContain('At least three `preview_frame` checks')
    expect(rawSkill).toContain('The composition is saved and published to the timeline')
    expect(rawSkill).not.toContain('awesome-design-md')

    expect(agent).toContain('skills/explainer-video/SKILL.md')
    expect(agent).toContain('Explainer Video')
    expect(agent).toContain('explainer video')
    expect(agent).toContain('local editable composition request, not a long-video provider generation request')
  })

  it('keeps sticker background removal in the node runtime', () => {
    const sticker = read('src/skills/sticker-maker/SKILL.md')

    expect(sticker).toContain('run_code({ runtime: "node" })')
    expect(sticker).toContain('sharp')
    expect(sticker).toContain('不要用 `runtime: "composition"` 做贴纸抠图')
    expect(sticker).toContain('真实 `imageUrl`')
  })
})
