import localizations from '@/lib/home-skill-localizations.json'

type LocalizedCopy = Record<string, string>

type HomeSkillLocalization = {
  id: string
  labels: LocalizedCopy
  prompts: LocalizedCopy
}

const localizationById = new Map(
  (localizations as HomeSkillLocalization[]).map(localization => [localization.id, localization]),
)

function asLocalizedCopy(value: unknown): LocalizedCopy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
  )
}

/**
 * Checked-in copy is the complete marketplace baseline. Database values win
 * per locale so Admin edits can safely override a single language.
 */
export function mergeHomeSkillLocalization<T extends Record<string, unknown>>(row: T): T & {
  labels: LocalizedCopy
  prompts: LocalizedCopy
} {
  const fallback = typeof row.id === 'string' ? localizationById.get(row.id) : undefined
  return {
    ...row,
    labels: {
      ...(fallback?.labels ?? {}),
      ...asLocalizedCopy(row.labels),
    },
    prompts: {
      ...(fallback?.prompts ?? {}),
      ...asLocalizedCopy(row.prompts),
    },
  }
}

export const HOME_SKILL_LOCALIZATION_COUNT = localizationById.size
