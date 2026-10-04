import { pickLocalizedValue, type Locale } from '@/lib/locales'

export interface HomeSkill {
  id: string
  labels: Record<string, string>
  image: string
  prompt: string
  prompts?: Record<string, string>
  skill_path?: string | null
  image_count?: number
  sort_order: number
  is_active?: boolean
  updated_at?: string
  before_images?: string[]
  categories?: string[]
}

export interface HomeSkillCategory {
  id: string
  labels: Record<string, string>
  descriptions?: Record<string, string>
  sort_order: number
  icon?: string | null
  is_active?: boolean
}

type HomeSkillInputFile = {
  name?: string
  type?: string
}

export function getRequiredHomeSkillImageCount(
  skill: Pick<HomeSkill, 'image_count'> | null | undefined,
): number {
  if (!skill) return 0
  const configuredCount = skill.image_count
  if (typeof configuredCount !== 'number' || !Number.isFinite(configuredCount)) return 1
  return Math.max(0, Math.trunc(configuredCount))
}

export function countHomeSkillImageFiles(files: readonly HomeSkillInputFile[]): number {
  return files.filter((file) => (
    file.type?.startsWith('image/')
    || /\.(?:heic|heif)$/i.test(file.name || '')
  )).length
}

export function hasRequiredHomeSkillImages(
  skill: Pick<HomeSkill, 'image_count'> | null | undefined,
  files: readonly HomeSkillInputFile[],
): boolean {
  return countHomeSkillImageFiles(files) >= getRequiredHomeSkillImageCount(skill)
}

export function getLocalizedSkillPrompt(skill: HomeSkill, locale: Locale): string {
  return pickLocalizedValue(skill.prompts, locale, skill.prompt || '')
}

export function getVisibleSkillCategories(
  skills: readonly HomeSkill[],
  definitions: readonly HomeSkillCategory[],
): HomeSkillCategory[] {
  const usedCategoryIds = new Set(
    skills.flatMap((skill) => Array.isArray(skill.categories) ? skill.categories : []),
  )

  return definitions
    .filter((definition) => definition.is_active !== false && usedCategoryIds.has(definition.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

export function filterHomeSkillsByCategory(
  skills: readonly HomeSkill[],
  categoryId: string,
): HomeSkill[] {
  if (!categoryId || categoryId === 'all') return [...skills]
  return skills.filter((skill) => Array.isArray(skill.categories) && skill.categories.includes(categoryId))
}

let cached: HomeSkill[] | null = null

export function getCachedHomeSkills(): HomeSkill[] {
  if (cached) return cached
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem('homeSkills')
    if (raw) { cached = JSON.parse(raw); return cached! }
  } catch {}
  return []
}

export function setCachedHomeSkills(skills: HomeSkill[]): void {
  cached = skills
  try { sessionStorage.setItem('homeSkills', JSON.stringify(skills)) } catch {}
}
