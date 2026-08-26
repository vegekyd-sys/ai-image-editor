import {
  evaluateSkillRun,
  fingerprintEvolvingSkill,
  recordEvolvingSkillUsage,
  resolveEvolvingSkill,
} from '@/lib/skill-evolution'
import { describe, expect, it, vi } from 'vitest'

describe('Skill Evolution', () => {
  it('resolves the three initial evolving Skill sources', () => {
    expect(resolveEvolvingSkill('prompts/animate.md')).toBe('animate')
    expect(resolveEvolvingSkill('src/lib/prompts/animate.md')).toBe('animate')
    expect(resolveEvolvingSkill('skills/tiktok-video/SKILL.md')).toBe('tiktok-video')
    expect(resolveEvolvingSkill('skills/talking-head/SKILL.md')).toBe('talking-head')
    expect(resolveEvolvingSkill('skills/remotion/SKILL.md')).toBeNull()
  })

  it('uses exact source content as the immutable version fingerprint', () => {
    const first = fingerprintEvolvingSkill('prompts/animate.md', 'version one')
    const same = fingerprintEvolvingSkill('src/lib/prompts/animate.md', 'version one')
    const changed = fingerprintEvolvingSkill('prompts/animate.md', 'version two')

    expect(first?.contentSha256).toHaveLength(64)
    expect(same?.contentSha256).toBe(first?.contentSha256)
    expect(changed?.contentSha256).not.toBe(first?.contentSha256)
    expect(first?.contentLength).toBe(11)
    expect(first?.bundleComplete).toBe(false)
  })

  it('versions the complete effective Skill bundle', () => {
    const root = 'skills/tiktok-video/SKILL.md'
    const paths = [
      'skills/tiktok-video/SKILL.md',
      'skills/tiktok-video/references/audio-sync.md',
      'skills/tiktok-video/references/caption-direction.md',
      'skills/tiktok-video/references/delivery-qa.md',
      'skills/tiktok-video/references/platform-layout.md',
      'prompts/animate.md',
      'skills/_shared/remotion-director-contract.md',
      'skills/_shared/spoken-caption.md',
      'skills/_shared/studio-production/production-contract.md',
      'skills/motion-design-video/SKILL.md',
    ]
    const components = Object.fromEntries(paths.map(path => [path, `content:${path}`]))
    const first = fingerprintEvolvingSkill(root, components[root], components)
    const changed = fingerprintEvolvingSkill(root, components[root], {
      ...components,
      'skills/tiktok-video/references/delivery-qa.md': 'changed review gate',
    })

    expect(first?.bundleComplete).toBe(true)
    expect(first?.components).toHaveLength(paths.length)
    expect(first?.components.filter(component => component.ownership === 'owned')).toHaveLength(5)
    expect(changed?.contentSha256).not.toBe(first?.contentSha256)
  })

  it('never blocks a creative run when telemetry storage fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fingerprint = await recordEvolvingSkillUsage({
      supabase: {
        rpc: async () => {
          throw new Error('telemetry unavailable')
        },
      },
      runId: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      sourcePath: 'prompts/animate.md',
      content: 'animate contract',
    })

    expect(fingerprint?.skillKey).toBe('animate')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('telemetry unavailable'))
    warn.mockRestore()
  })

  it('records deployment identity without storing Skill content', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    vi.stubEnv('VERCEL_URL', 'preview.example.test')

    await recordEvolvingSkillUsage({
      supabase: { rpc },
      runId: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      sourcePath: 'prompts/animate.md',
      content: 'private Skill content',
    })

    expect(rpc).toHaveBeenCalledWith('record_skill_run_usage', expect.objectContaining({
      p_metadata: expect.objectContaining({
        deploymentUrl: 'preview.example.test',
        bundleComplete: false,
      }),
    }))
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain('private Skill content')
    vi.unstubAllEnvs()
  })

  it('does not call incomplete evidence a failure', () => {
    const evaluation = evaluateSkillRun('talking-head', {
      artifactCreated: true,
      fullyDecodable: true,
    })

    expect(evaluation.outcome).toBe('inconclusive')
    expect(evaluation.overallScore).toBeNull()
    expect(evaluation.hardGates).toContainEqual({
      key: 'captions_synchronized',
      status: 'unknown',
    })
  })

  it('treats final-media integrity as a hard failure', () => {
    const evaluation = evaluateSkillRun('talking-head', {
      artifactCreated: true,
      fullyDecodable: true,
      durationComplete: false,
      audioContinuous: true,
      captionsSynchronized: true,
      noUnintendedRepeatedFrames: true,
      qualityDimensions: {
        editorialJudgment: 90,
        narrativeClarity: 90,
        captionQuality: 90,
        audioVisualCohesion: 90,
        visualQuality: 90,
      },
    })

    expect(evaluation.outcome).toBe('fail')
    expect(evaluation.overallScore).toBe(90)
  })

  it('applies conditional TikTok caption and safe-zone gates', () => {
    const evaluation = evaluateSkillRun('tiktok-video', {
      artifactCreated: true,
      fullyDecodable: true,
      durationComplete: true,
      deliveryResolutionCorrect: true,
      audioWithinSpec: true,
      hasSpeech: false,
      hasVisibleText: false,
    })

    expect(evaluation.outcome).toBe('pass')
    expect(evaluation.hardGates).toContainEqual({
      key: 'captions_synchronized',
      status: 'not_applicable',
    })
    expect(evaluation.hardGates).toContainEqual({
      key: 'safe_zone_compliant',
      status: 'not_applicable',
    })
  })

  it('requires enough scored dimensions before publishing a score', () => {
    const sparse = evaluateSkillRun('animate', {
      qualityDimensions: { visualQuality: 100 },
    })
    const covered = evaluateSkillRun('animate', {
      qualityDimensions: {
        visualQuality: 80,
        promptFidelity: 90,
        motionCoherence: 70,
      },
    })

    expect(sparse.overallScore).toBeNull()
    expect(sparse.scoreCoverage).toBe(0.3)
    expect(covered.overallScore).toBe(80)
    expect(covered.scoreCoverage).toBe(0.8)
  })
})
