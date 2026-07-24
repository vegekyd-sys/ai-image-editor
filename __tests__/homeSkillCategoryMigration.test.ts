import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260715120000_home_skill_categories_i18n.sql'),
  'utf8',
)

describe('home skill category migration', () => {
  it('is non-destructive and preserves current or custom category assignments', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS prompts')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS categories')
    expect(migration).not.toMatch(/\bDROP\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).toContain('jsonb_array_elements_text')
    expect(migration).toContain('SELECT DISTINCT candidate.category_id')
  })

  it('retires the overlapping experimental taxonomy without deleting it', () => {
    expect(migration).toContain('SET is_active = false')
    for (const category of ['trending', 'anime', 'fandom', 'portrait', 'creative', 'idol', 'pets']) {
      expect(migration).toContain(`'${category}'`)
    }
  })

  it('seeds the seven historical taxonomy definitions in all four locales', () => {
    for (const category of ['video', 'idol-social', 'visual', 'utility', 'ip-fantasy', 'pet', 'travel']) {
      expect(migration).toContain(`'${category}'`)
    }
    for (const locale of ['zh', 'zh-Hant', 'ja', 'en']) {
      expect(migration).toContain(`\"${locale}\"`)
    }
  })

  it('exposes category reads while keeping writes on the service role', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.skill_categories TO anon, authenticated')
    expect(migration).toContain('GRANT ALL ON TABLE public.skill_categories TO service_role')
  })

  it('backfills every ID from the checked-in historical marketplace export', () => {
    const historical = JSON.parse(readFileSync(
      join(process.cwd(), 'docs/meta-skill-research/supabase-home-skills.json'),
      'utf8',
    )) as { id: string; category: string }[]

    for (const skill of historical) {
      expect(migration).toContain(`('${skill.id}'::uuid, '${skill.category}')`)
    }
  })
})
