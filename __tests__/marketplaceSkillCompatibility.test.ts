import { describe, expect, it } from 'vitest'
import {
  deriveMarketplaceSkillName,
  normalizeMarketplaceSkillMd,
  parseSkillMd,
} from '@/lib/skill-registry'

describe('legacy marketplace Skill compatibility', () => {
  it('adds only a missing description to a marketplace Skill with valid frontmatter', () => {
    const legacy = `---
name: makaron-world-cup-ticket-card-video
allowed-tools: [generate_video, analyze_image]
---

# Core Concept

Create the final ticket-card video.`

    expect(parseSkillMd(legacy)).toBeNull()
    const normalized = normalizeMarketplaceSkillMd(legacy, {
      name: 'world-cup-ticket-card',
      description: 'Transform into a World Cup star card.',
    })
    expect(parseSkillMd(normalized)).toMatchObject({
      name: 'makaron-world-cup-ticket-card-video',
      description: 'Transform into a World Cup star card.',
      allowedTools: ['generate_video', 'analyze_image'],
    })
  })

  it('wraps a legacy markdown-only marketplace Skill with safe fallback metadata', () => {
    const legacy = '# FPV Drone Flythrough Video\n\nGenerate the final cinematic flythrough.'

    expect(parseSkillMd(legacy)).toBeNull()
    const normalized = normalizeMarketplaceSkillMd(legacy, {
      name: 'drone-rush',
      description: 'Create an FPV drone flythrough.',
    })
    expect(parseSkillMd(normalized)).toMatchObject({
      name: 'drone-rush',
      description: 'Create an FPV drone flythrough.',
      template: legacy,
    })
  })

  it('derives a stable safe name from the server-verified marketplace URL', () => {
    expect(deriveMarketplaceSkillName(
      'https://cdn.makaron.app/storage/v1/object/public/images/marketplace/skills/Drone%20Rush.zip',
      'fc61968f-5bd1-45b4-9477-7141323b2d44',
    )).toBe('drone-rush')
    expect(deriveMarketplaceSkillName('', 'fc61968f-5bd1-45b4-9477-7141323b2d44'))
      .toBe('home-skill-fc61968f')
  })
})
