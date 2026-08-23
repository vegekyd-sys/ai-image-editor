import {
  evaluateSkillRun,
  fingerprintEvolvingSkill,
  resolveEvolvingSkill,
} from '@/lib/skill-evolution'

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
    expect(covered.overallScore).toBeCloseTo(79.7, 1)
    expect(covered.scoreCoverage).toBe(0.8)
  })
})
