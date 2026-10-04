import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  countHomeSkillImageFiles,
  getRequiredHomeSkillImageCount,
  hasRequiredHomeSkillImages,
  type HomeSkill,
} from '@/lib/home-skills'

function skill(imageCount?: number): HomeSkill {
  return {
    id: 'skill-1',
    labels: { en: 'Test Skill' },
    image: 'https://cdn.example.com/cover.jpg',
    prompt: 'Create the result',
    image_count: imageCount,
    sort_order: 0,
  }
}

describe('home skill input requirements', () => {
  it('requires one image for legacy skills without an explicit image count', () => {
    expect(getRequiredHomeSkillImageCount(skill())).toBe(1)
    expect(hasRequiredHomeSkillImages(skill(), [])).toBe(false)
  })

  it('allows an explicitly text-only skill to require zero images', () => {
    expect(getRequiredHomeSkillImageCount(skill(0))).toBe(0)
    expect(hasRequiredHomeSkillImages(skill(0), [])).toBe(true)
  })

  it('counts image and HEIC files but never counts videos as images', () => {
    const files = [
      { name: 'portrait.jpg', type: 'image/jpeg' },
      { name: 'portrait.HEIC', type: '' },
      { name: 'clip.mp4', type: 'video/mp4' },
    ]

    expect(countHomeSkillImageFiles(files)).toBe(2)
    expect(hasRequiredHomeSkillImages(skill(2), files)).toBe(true)
    expect(hasRequiredHomeSkillImages(skill(3), files)).toBe(false)
  })

  it('does not gate ordinary non-skill project creation', () => {
    expect(getRequiredHomeSkillImageCount(null)).toBe(0)
    expect(hasRequiredHomeSkillImages(null, [])).toBe(true)
  })

  it('keeps both the primary action and project creation gates wired', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/home/page.tsx'), 'utf8')

    expect(source).toContain('|| !hasRequiredHomeSkillImages(homeSkill, files)')
    expect(source).toContain('if (activeSkill && !hasEnoughPhotos)')
    expect(source).not.toContain('if (isGuestSkillAction && createInput.files.length < requiredPhotoCount)')
  })
})
