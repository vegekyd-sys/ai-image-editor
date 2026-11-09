import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/workspace', () => ({
  readFile: vi.fn(async (path: string) => {
    const files: Record<string, string> = {
      'skills/plain-template/SKILL.md': '---\nname: plain-template\ndescription: A dance video template.\n---\n\nWrite a 10s script and call generate_animation. Kling and Seedance are mentioned only as background.\n',
      'skills/seedance-template/SKILL.md': '---\nname: seedance-template\ndescription: Soccer template.\nmetadata:\n  makaron:\n    modelPreference: [seedance, kling, gemini]\n---\n\nGenerate.\n',
      'skills/my-own-skill/SKILL.md': '---\nname: my-own-skill\ndescription: User skill.\n---\n\nGenerate.\n',
    }
    return files[path] ? { content: files[path], contentType: 'text/markdown', path } : null
  }),
}))

import {
  TEMPLATE_SKILL_DEFAULT_VIDEO_MODEL,
  activeSkillNameFromPrompt,
  applyTemplateVideoModel,
  parseSkillExplicitVideoModel,
  resolveTemplateSkillVideoModel,
  skillNameFromSkillPath,
} from '../src/lib/template-skill-video-model'
import { getSkillLaunchSystemDirective } from '../src/lib/skill-launch-context'

function supabaseWith(rows: Record<string, string | null>) {
  return {
    from: () => {
      const filters: Record<string, string> = {}
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query },
        limit: async () => {
          const path = filters.path
          return path in rows ? { data: [{ marketplace_id: rows[path] }], error: null } : { data: [], error: null }
        },
      }
      return query
    },
  }
}

describe('template Skill video model', () => {
  it('keeps FAL H3 Max as the template default', () => {
    expect(TEMPLATE_SKILL_DEFAULT_VIDEO_MODEL).toBe('fal-h3-max')
  })

  it.each([
    ['---\nname: a\ndescription: d\nmetadata:\n  makaron:\n    modelPreference: [openai, grok, seedance-mini]\n---\nbody', 'grok'],
    ['---\nname: a\ndescription: d\nmetadata:\n  makaron:\n    modelPreference: [openai]\n---\nUse `model: "minimax-h3-max"` for the clip.', 'minimax-h3-max'],
    ['---\nname: a\ndescription: d\n---\nRun makaron video create --video-model wan-3.0-prime', 'wan-3.0-prime'],
    ['---\nname: a\ndescription: d\nmodel: fal-h3-max\n---\nbody', 'fal-h3-max'],
    ['---\nname: a\ndescription: d\n---\nUse model: gpt-image-2 for stills, then animate with model: "seedance".', 'seedance'],
  ])('reads the explicit video model from a Skill (%#)', (md, expected) => {
    expect(parseSkillExplicitVideoModel(md)).toBe(expected)
  })

  it('does not treat prose mentions, image models or retired Kling O3 as a choice', () => {
    expect(parseSkillExplicitVideoModel('---\nname: a\ndescription: d\n---\nKling and Seedance both handle dance well.')).toBeUndefined()
    expect(parseSkillExplicitVideoModel('---\nname: a\ndescription: d\nmetadata:\n  makaron:\n    modelPreference: [kling, openai]\n---\nbody')).toBeUndefined()
  })

  it('replaces only an omitted model or the app-wide default', () => {
    expect(applyTemplateVideoModel(undefined, 'fal-h3-max')).toBe('fal-h3-max')
    expect(applyTemplateVideoModel('kling-4-flash', 'fal-h3-max')).toBe('fal-h3-max')
    expect(applyTemplateVideoModel('seedance-2.5', 'fal-h3-max')).toBe('seedance-2.5')
    expect(applyTemplateVideoModel('kling-4-flash', undefined)).toBe('kling-4-flash')
  })

  it('resolves only marketplace templates, in priority order', async () => {
    const supabase = supabaseWith({
      'skills/plain-template/SKILL.md': 'home-skill-1',
      'skills/seedance-template/SKILL.md': 'home-skill-2',
      'skills/my-own-skill/SKILL.md': null,
    })
    await expect(resolveTemplateSkillVideoModel({ supabase, userId: 'u', candidateSkillNames: ['plain-template'] }))
      .resolves.toEqual({ skillName: 'plain-template', model: 'fal-h3-max', explicit: false })
    await expect(resolveTemplateSkillVideoModel({ supabase, userId: 'u', candidateSkillNames: ['seedance-template'] }))
      .resolves.toEqual({ skillName: 'seedance-template', model: 'seedance', explicit: true })
    await expect(resolveTemplateSkillVideoModel({ supabase, userId: 'u', candidateSkillNames: ['my-own-skill', 'unknown'] })).resolves.toBeUndefined()
    await expect(resolveTemplateSkillVideoModel({ supabase, userId: 'u', candidateSkillNames: ['my-own-skill', 'plain-template'] }))
      .resolves.toMatchObject({ skillName: 'plain-template' })
  })

  it('recognises the Skill sources of a run', () => {
    expect(skillNameFromSkillPath('skills/plain-template/SKILL.md')).toBe('plain-template')
    expect(skillNameFromSkillPath('skills/plain-template/assets/a.png')).toBeUndefined()
    expect(activeSkillNameFromPrompt('[Active skill: plain-template]\nmake it')).toBe('plain-template')
    expect(activeSkillNameFromPrompt('make it')).toBeUndefined()
  })

  it('tells a trusted template launch to keep FAL H3 Max when the Skill names no model', () => {
    const directive = getSkillLaunchSystemDirective({ intent: 'complete-result', skillName: 'plain-template', homeSkillId: 'h1' } as never)
    expect(directive).toContain('If it names none, use `fal-h3-max` at 768p instead of the app default')
  })
})

describe('generate_animation with a template Skill', async () => {
  const { generateAnimationHarness } = await import('./helpers/generateAnimationHarness')
  const request = {
    story_prompt: 'Dance\nShot 1 (5s): <<<media_2>>> dances in a neon studio.',
    duration: 5, aspect_ratio: '9:16', video_intent: 'generate', video_operation: 'generate',
  }
  const run = async (args: Record<string, unknown>, setup?: (h: ReturnType<typeof generateAnimationHarness>) => void) => {
    const h = generateAnimationHarness()
    h.ctx.videoModel = 'kling-4-flash'
    h.templateVideo.current = { skillName: 'plain-template', model: 'fal-h3-max', explicit: false }
    setup?.(h)
    await h.tool.execute(h.tool.inputSchema.parse({ ...request, ...args }))
    return h.createVideo.mock.calls[0]?.[0]
  }

  it('renders on FAL H3 Max when the template names no model and the Agent omits or defaults it', async () => {
    expect(await run({})).toMatchObject({ videoModel: 'fal-h3-max' })
    expect(await run({ model: 'kling-4-flash', video_resolution: '720p' })).toMatchObject({ videoModel: 'fal-h3-max', videoResolution: '768p' })
  })

  it('keeps a deliberate non-default choice and an explicit app selector lock', async () => {
    expect(await run({ model: 'wan-3.0' })).toMatchObject({ videoModel: 'wan-3.0' })
    expect(await run({}, h => { h.ctx.videoAuto = false })).toMatchObject({ videoModel: 'kling-4-flash' })
  })

  it('uses the default model outside template Skills', async () => {
    expect(await run({}, h => { h.templateVideo.current = undefined })).toMatchObject({ videoModel: 'kling-4-flash' })
  })
})
