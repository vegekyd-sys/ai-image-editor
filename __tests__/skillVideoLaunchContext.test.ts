import { describe, expect, it } from 'vitest'
import {
  createVideoSkillLaunchContext,
  getSkillLaunchSystemDirective,
  normalizeSkillLaunchContext,
  shouldContinueSkillVideoSubmission,
  verifySkillLaunchContext,
} from '@/lib/skill-launch-context'

const videoSkill = {
  id: 'video-story',
  skill_path: 'skills/video-story.zip',
  categories: ['video'],
}

describe('Video Skill launch context', () => {
  it('authorizes only a clear homepage Video Skill template launch', () => {
    expect(createVideoSkillLaunchContext(videoSkill, 'Make a cinematic launch clip')).toEqual({
      source: 'home-skill-template',
      homeSkillId: 'video-story',
      intent: 'video',
    })
    expect(createVideoSkillLaunchContext({ ...videoSkill, categories: ['image'] }, 'Animate it')).toBeUndefined()
    expect(createVideoSkillLaunchContext({ ...videoSkill, skill_path: null }, 'Animate it')).toBeUndefined()
    expect(createVideoSkillLaunchContext(videoSkill, '   ')).toBeUndefined()
    expect(createVideoSkillLaunchContext(videoSkill, 'Show me the script first')).toBeUndefined()
    expect(createVideoSkillLaunchContext(videoSkill, 'Make a 30 second video')).toBeUndefined()
  })

  it('normalizes transport data and rejects untrusted lookalikes', () => {
    const context = createVideoSkillLaunchContext(videoSkill, 'Animate it')
    expect(normalizeSkillLaunchContext(context)).toEqual(context)
    expect(normalizeSkillLaunchContext({ source: 'manual-cui', homeSkillId: 'video-story', intent: 'video' })).toBeUndefined()
    expect(normalizeSkillLaunchContext({ source: 'home-skill-template', homeSkillId: '', intent: 'video' })).toBeUndefined()
  })

  it('revalidates the Video Skill against the server-side marketplace row', async () => {
    const context = createVideoSkillLaunchContext(videoSkill, 'Animate it')
    const single = async () => ({
      data: { id: 'video-story', skill_path: 'skills/video-story.zip', categories: ['video'], is_active: true },
      error: null,
    })
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    }
    await expect(verifySkillLaunchContext(admin as never, context)).resolves.toEqual(context)

    const nonVideoAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { ...videoSkill, categories: ['image'], is_active: true }, error: null }) }),
        }),
      }),
    }
    await expect(verifySkillLaunchContext(nonVideoAdmin as never, context)).resolves.toBeUndefined()
  })

  it('adds same-turn submission only for the trusted launch context', () => {
    const context = createVideoSkillLaunchContext(videoSkill, 'Animate it')
    const directive = getSkillLaunchSystemDirective(context)

    expect(directive).toContain('Write the complete visible script')
    expect(directive).toContain('call generate_animation in the same turn')
    expect(directive).toContain('must not change ordinary CUI or editor video requests')
    expect(getSkillLaunchSystemDirective(undefined)).toBe('')
  })

  it('continues a trusted run when a visible script exists but submission did not start', () => {
    const context = createVideoSkillLaunchContext(videoSkill, 'Animate it')
    const visibleScript = 'Launch Story\nShot 1 (5s): A slow push-in reveals the subject.'

    expect(shouldContinueSkillVideoSubmission({ context, visibleText: visibleScript, submissionStarted: false })).toBe(true)
    expect(shouldContinueSkillVideoSubmission({ context, visibleText: visibleScript, submissionStarted: true })).toBe(false)
    expect(shouldContinueSkillVideoSubmission({ context: undefined, visibleText: visibleScript, submissionStarted: false })).toBe(false)
    expect(shouldContinueSkillVideoSubmission({ context, visibleText: 'Which photo should I use?', submissionStarted: false })).toBe(false)
  })
})
