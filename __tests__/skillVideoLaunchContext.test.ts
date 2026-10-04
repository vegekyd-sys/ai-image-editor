import { describe, expect, it } from 'vitest'
import {
  createHomeSkillLaunchContext,
  getSkillLaunchSystemDirective,
  normalizeSkillLaunchContext,
  verifySkillLaunchContext,
} from '@/lib/skill-launch-context'

const skillTemplate = {
  id: 'skill-template',
  skill_path: 'skills/template.zip',
  categories: ['video'],
  prompt: 'Turn my photo into a video',
  prompts: { 'zh-Hant': '把我的照片做成影片' },
}

const installedSkillName = 'cinematic-launch'

function createVerifiedAdmin(options?: { installedPath?: string | null; active?: boolean; skillPath?: string | null }) {
  return {
    from: (table: string) => {
      if (table === 'home_skills') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  ...skillTemplate,
                  skill_path: options?.skillPath === undefined ? skillTemplate.skill_path : options.skillPath,
                  is_active: options?.active ?? true,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'workspace_files') {
        const result = {
          data: options?.installedPath === null
            ? []
            : [{ path: options?.installedPath ?? `skills/${installedSkillName}/SKILL.md` }],
          error: null,
        }
        const builder: Record<string, (...args: unknown[]) => unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.limit = async () => result
        return {
          ...builder,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('Skill template launch context', () => {
  it('authorizes every real homepage Skill template through a final result', () => {
    const imageSkillTemplate = {
      ...skillTemplate,
      categories: ['visual'],
      prompt: 'Turn this into a poster',
      prompts: {},
    }
    const crossCategoryVideoTemplate = {
      ...skillTemplate,
      categories: ['idol-social'],
      prompt: 'Upload a photo, generate a street paparazzi style video.',
    }
    expect(createHomeSkillLaunchContext(skillTemplate, 'Make a cinematic launch clip', installedSkillName)).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      skillName: installedSkillName,
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext(imageSkillTemplate, 'Make it dramatic', installedSkillName)).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      skillName: installedSkillName,
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext(crossCategoryVideoTemplate, '上傳一張照片，生成街頭狗仔風格的影片。', installedSkillName)).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      skillName: installedSkillName,
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext({ ...skillTemplate, skill_path: null }, 'Make it', installedSkillName)).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, '   ', installedSkillName)).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Show me the script first', installedSkillName)).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Animate it', undefined)).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Animate it', '../wrong-skill')).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Make a 30 second video', installedSkillName)).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      skillName: installedSkillName,
      intent: 'complete-result',
    })
  })

  it('normalizes transport data and rejects untrusted lookalikes', () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it', installedSkillName)
    expect(normalizeSkillLaunchContext(context)).toEqual(context)
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: 'skill-template', skillName: installedSkillName, intent: 'video' })).toEqual(context)
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: 'skill-template', intent: 'video' })).toBeUndefined()
    expect(normalizeSkillLaunchContext({ source: 'manual-cui', homeSkillId: 'skill-template', intent: 'complete-result' })).toBeUndefined()
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: '', skillName: installedSkillName, intent: 'video' })).toBeUndefined()
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: 'skill-template', skillName: 'skills/escape', intent: 'complete-result' })).toBeUndefined()
  })

  it('revalidates both the marketplace row and the installed Skill path', async () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it', installedSkillName)
    await expect(verifySkillLaunchContext(createVerifiedAdmin() as never, context, 'user-1')).resolves.toEqual(context)
    await expect(verifySkillLaunchContext(createVerifiedAdmin({ skillPath: null }) as never, context, 'user-1')).resolves.toBeUndefined()
    await expect(verifySkillLaunchContext(createVerifiedAdmin({ installedPath: null }) as never, context, 'user-1')).resolves.toBeUndefined()
    await expect(verifySkillLaunchContext(createVerifiedAdmin({ installedPath: 'skills/another-skill/SKILL.md' }) as never, context, 'user-1')).resolves.toBeUndefined()
    await expect(verifySkillLaunchContext(createVerifiedAdmin() as never, context, '')).resolves.toBeUndefined()
  })

  it('authorizes the complete workflow only for the trusted launch context', () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it', installedSkillName)
    const directive = getSkillLaunchSystemDirective(context)

    expect(directive).toContain(`Active Skill: ${installedSkillName}`)
    expect(directive).toContain(`read_file with \`skills/${installedSkillName}/SKILL.md\``)
    expect(directive).toContain('Do not infer the Skill from the user prompt alone')
    expect(directive).toContain('authorizes the complete workflow through a final usable result')
    expect(directive).toContain('do not stop for confirmation')
    expect(directive).toContain('call generate_animation in the same run')
    expect(directive).toContain('Do not apply this exception to ordinary CUI or editor requests')
    expect(getSkillLaunchSystemDirective(undefined)).toBe('')
  })
})
