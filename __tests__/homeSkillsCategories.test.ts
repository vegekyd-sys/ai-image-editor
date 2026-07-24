import { describe, expect, it } from 'vitest'
import {
  filterHomeSkillsByCategory,
  getLocalizedSkillPrompt,
  getVisibleSkillCategories,
  type HomeSkill,
  type HomeSkillCategory,
} from '@/lib/home-skills'

function skill(id: string, categories?: string[]): HomeSkill {
  return {
    id,
    labels: { en: id },
    image: `${id}.jpg`,
    prompt: `legacy-${id}`,
    sort_order: 0,
    categories,
  }
}

describe('home skill localization and categories', () => {
  it('localizes prompts with the shared four-locale fallback chain', () => {
    const localized = {
      ...skill('localized'),
      prompts: {
        zh: '简体提示词',
        'zh-Hant': '繁體提示詞',
        ja: '日本語プロンプト',
        en: 'English prompt',
      },
    }

    expect(getLocalizedSkillPrompt(localized, 'zh')).toBe('简体提示词')
    expect(getLocalizedSkillPrompt(localized, 'zh-Hant')).toBe('繁體提示詞')
    expect(getLocalizedSkillPrompt(localized, 'ja')).toBe('日本語プロンプト')
    expect(getLocalizedSkillPrompt(localized, 'en')).toBe('English prompt')
  })

  it('falls back through zh-Hant to zh, ja to en, then to the legacy prompt', () => {
    const partiallyLocalized = {
      ...skill('partial'),
      prompts: { zh: '简体提示词', en: 'English prompt' },
    }
    expect(getLocalizedSkillPrompt(partiallyLocalized, 'zh-Hant')).toBe('简体提示词')
    expect(getLocalizedSkillPrompt(partiallyLocalized, 'ja')).toBe('English prompt')
    expect(getLocalizedSkillPrompt(skill('legacy'), 'ja')).toBe('legacy-legacy')
  })

  it('returns only active, used category definitions in deterministic order', () => {
    const skills = [skill('one', ['video', 'travel']), skill('two', ['pet'])]
    const definitions: HomeSkillCategory[] = [
      { id: 'pet', labels: { en: 'Pets' }, sort_order: 2 },
      { id: 'unused', labels: { en: 'Unused' }, sort_order: 0 },
      { id: 'travel', labels: { en: 'Travel' }, sort_order: 1, is_active: false },
      { id: 'video', labels: { en: 'Video' }, sort_order: 1 },
    ]

    expect(getVisibleSkillCategories(skills, definitions).map((category) => category.id)).toEqual([
      'video',
      'pet',
    ])
    expect(definitions.map((category) => category.id)).toEqual(['pet', 'unused', 'travel', 'video'])
  })

  it('filters by membership while All preserves the API order', () => {
    const skills = [skill('one', ['video']), skill('two'), skill('three', ['video', 'travel'])]

    expect(filterHomeSkillsByCategory(skills, 'video').map((item) => item.id)).toEqual(['one', 'three'])
    expect(filterHomeSkillsByCategory(skills, 'travel').map((item) => item.id)).toEqual(['three'])
    expect(filterHomeSkillsByCategory(skills, 'all').map((item) => item.id)).toEqual(['one', 'two', 'three'])
  })
})
