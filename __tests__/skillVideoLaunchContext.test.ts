import { describe, expect, it } from 'vitest'
import {
  createHomeSkillLaunchContext,
  getSkillLaunchSystemDirective,
  normalizeSkillLaunchContext,
  shouldContinueSkillVideoSubmission,
  verifySkillLaunchContext,
} from '@/lib/skill-launch-context'

const skillTemplate = {
  id: 'skill-template',
  skill_path: 'skills/template.zip',
  categories: ['video'],
  prompt: 'Turn my photo into a video',
  prompts: { 'zh-Hant': '把我的照片做成影片' },
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
    expect(createHomeSkillLaunchContext(skillTemplate, 'Make a cinematic launch clip')).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext(imageSkillTemplate, 'Make it dramatic')).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext(crossCategoryVideoTemplate, '上傳一張照片，生成街頭狗仔風格的影片。')).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      intent: 'complete-result',
    })
    expect(createHomeSkillLaunchContext({ ...skillTemplate, skill_path: null }, 'Make it')).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, '   ')).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Show me the script first')).toBeUndefined()
    expect(createHomeSkillLaunchContext(skillTemplate, 'Make a 30 second video')).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'skill-template',
      intent: 'complete-result',
    })
  })

  it('normalizes transport data and rejects untrusted lookalikes', () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it')
    expect(normalizeSkillLaunchContext(context)).toEqual(context)
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: 'skill-template', intent: 'video' })).toEqual(context)
    expect(normalizeSkillLaunchContext({ source: 'manual-cui', homeSkillId: 'skill-template', intent: 'complete-result' })).toBeUndefined()
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: '', intent: 'video' })).toBeUndefined()
  })

  it('revalidates the Skill template against the server-side marketplace row', async () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it')
    const single = async () => ({
      data: { ...skillTemplate, is_active: true },
      error: null,
    })
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    }
    await expect(verifySkillLaunchContext(admin as never, context)).resolves.toEqual(context)

    const imageSkillAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                ...skillTemplate,
                categories: ['visual'],
                prompt: 'Turn this into a poster.',
                is_active: true,
              },
              error: null,
            }),
          }),
        }),
      }),
    }
    await expect(verifySkillLaunchContext(imageSkillAdmin as never, context)).resolves.toEqual(context)

    const missingSkillAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ...skillTemplate, skill_path: null, is_active: true },
              error: null,
            }),
          }),
        }),
      }),
    }
    await expect(verifySkillLaunchContext(missingSkillAdmin as never, context)).resolves.toBeUndefined()
  })

  it('authorizes the complete workflow only for the trusted launch context', () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it')
    const directive = getSkillLaunchSystemDirective(context)

    expect(directive).toContain('authorizes the complete workflow through a final usable result')
    expect(directive).toContain('do not stop for confirmation')
    expect(directive).toContain('call generate_animation in the same run')
    expect(directive).toContain('Do not apply this exception to ordinary CUI or editor requests')
    expect(getSkillLaunchSystemDirective(undefined)).toBe('')
  })

  it('continues a trusted run when a visible script exists but submission did not start', () => {
    const context = createHomeSkillLaunchContext(skillTemplate, 'Animate it')
    const visibleScript = 'Launch Story\nShot 1 (5s): A slow push-in reveals the subject.'

    expect(shouldContinueSkillVideoSubmission({ context, visibleText: visibleScript, submissionStarted: false })).toBe(true)
    expect(shouldContinueSkillVideoSubmission({ context, visibleText: '分鏡腳本\n鏡頭 1：主角走進夜色。', submissionStarted: false })).toBe(true)
    expect(shouldContinueSkillVideoSubmission({ context, visibleText: visibleScript, submissionStarted: true })).toBe(false)
    expect(shouldContinueSkillVideoSubmission({ context: undefined, visibleText: visibleScript, submissionStarted: false })).toBe(false)
    expect(shouldContinueSkillVideoSubmission({ context, visibleText: 'Which photo should I use?', submissionStarted: false })).toBe(false)
  })
})
