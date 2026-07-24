import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeHomeSkillLocalization } from '@/lib/home-skill-localizations.server'

type HistoricalSkill = {
  id: string
  en: string
  zh: string
  prompt: string
}

type LocalizedSkill = {
  id: string
  labels: Record<string, string>
  prompts: Record<string, string>
}

const historical = JSON.parse(readFileSync(
  join(process.cwd(), 'docs/meta-skill-research/supabase-home-skills.json'),
  'utf8',
)) as HistoricalSkill[]

const currentAdditions = JSON.parse(readFileSync(
  join(process.cwd(), 'docs/meta-skill-research/home-skills-current-additions-20260715.json'),
  'utf8',
)) as HistoricalSkill[]

const trackedSkills = [...historical, ...currentAdditions]

const localized = JSON.parse(readFileSync(
  join(process.cwd(), 'src/lib/home-skill-localizations.json'),
  'utf8',
)) as LocalizedSkill[]

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260715121000_home_skill_content_i18n.sql'),
  'utf8',
)

const locales = ['en', 'zh', 'zh-Hant', 'ja'] as const

describe('home skill content i18n', () => {
  it('covers the historical catalog and every current addition exactly once', () => {
    expect(currentAdditions).toHaveLength(57)
    expect(localized).toHaveLength(trackedSkills.length)
    expect(new Set(localized.map(skill => skill.id))).toEqual(new Set(trackedSkills.map(skill => skill.id)))
  })

  it('has complete four-locale titles and default prompts without changing source copy', () => {
    const byId = new Map(localized.map(skill => [skill.id, skill]))

    for (const source of trackedSkills) {
      const skill = byId.get(source.id)
      expect(skill).toBeDefined()
      expect(skill?.labels.en).toBe(source.en)
      expect(skill?.labels.zh).toBe(source.zh)
      for (const locale of locales) {
        expect(skill?.labels[locale]?.trim().length).toBeGreaterThan(0)
        expect(skill?.prompts[locale]?.trim().length).toBeGreaterThan(0)
      }

      const hanCount = source.prompt.match(/[\u3400-\u9fff]/g)?.length ?? 0
      const latinCount = source.prompt.match(/[A-Za-z]/g)?.length ?? 0
      const sourceLocale = hanCount > latinCount ? 'zh' : 'en'
      expect(skill?.prompts[sourceLocale]).toBe(source.prompt)
    }
  })

  it('lets per-locale Admin copy override the checked-in baseline', () => {
    const source = localized[0]
    const merged = mergeHomeSkillLocalization({
      id: source.id,
      labels: { ja: '管理画面のタイトル' },
      prompts: { ja: '管理画面のプロンプト' },
    })

    expect(merged.labels.en).toBe(source.labels.en)
    expect(merged.labels.ja).toBe('管理画面のタイトル')
    expect(merged.prompts.zh).toBe(source.prompts.zh)
    expect(merged.prompts.ja).toBe('管理画面のプロンプト')
  })

  it('backfills all four locales while preserving later database edits', () => {
    for (const skill of trackedSkills) expect(migration).toContain(`'${skill.id}'::uuid`)
    for (const locale of locales) expect(migration).toContain(`"${locale}"`)
    expect(migration).toContain("localized.labels || COALESCE(skill.labels, '{}'::jsonb)")
    expect(migration).toContain("localized.prompts || COALESCE(skill.prompts, '{}'::jsonb)")
  })
})

describe('home skill category interaction copy', () => {
  const homePage = readFileSync(join(process.cwd(), 'src/app/home/page.tsx'), 'utf8')
  const topBar = readFileSync(join(process.cwd(), 'src/components/TopBar.tsx'), 'utf8')
  const categoryMigration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260715120000_home_skill_categories_i18n.sql'),
    'utf8',
  )

  it('removes the marketplace subtitle from the rendered home page', () => {
    expect(homePage).not.toContain("t('skills.subtitle')")
  })

  it('lets Safari swipe the skill card area between category tabs without masking the rail', () => {
    expect(homePage).toContain('touch-action: pan-y pinch-zoom')
    expect(homePage).toContain('data-skill-category-swipe-region="true"')
    expect(homePage).toContain("skillGrid.addEventListener('touchmove', onTouchMove, { passive: false })")
    expect(homePage).toContain('getAdjacentHomeSkillCategoryId')
    expect(homePage).toContain("handleCategoryChange(nextCategoryId, direction)")
    expect(homePage).toContain('onClickCapture={handleSkillGridClickCapture}')
    expect(homePage).toContain('onPointerMove={handleCategoryPointerMove}')
    expect(homePage).toContain('scroller.scrollLeft = drag.startScrollLeft - deltaX')
    expect(homePage).not.toContain('-webkit-mask-image')
    expect(homePage).not.toContain('linear-gradient(to bottom, rgba(0,0,0')
    expect(topBar).toContain("closest('[data-horizontal-swipe-region=\"true\"]')")
  })

  it('uses content-accurate names for motion and mixed creative templates', () => {
    expect(categoryMigration).toContain('"zh":"动态影像"')
    expect(categoryMigration).toContain('"en":"Motion"')
    expect(categoryMigration).toContain('"zh":"创意实验"')
    expect(categoryMigration).toContain('"en":"Creative Lab"')
  })
})
