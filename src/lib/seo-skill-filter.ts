type SkillLike = {
  labels?: Record<string, string> | null
  prompt?: string | null
}

const NON_INDEXABLE_SKILL_TERMS = [
  'android 18',
  'attack on titan',
  'boa hancock',
  'chainsaw man',
  'darling in the franxx',
  'dragon ball',
  'game of thrones',
  'ghost in the shell',
  'gojo',
  'hbo original',
  'iron throne',
  'jujutsu',
  'luffy',
  'makima',
  'netflix',
  'one piece',
  'spirited away',
  'squid game',
  'studio ghibli',
  'totoro',
  'zero two',
]

export function isIndexableSkill(skill: SkillLike) {
  const labelText = skill.labels ? Object.values(skill.labels).join(' ') : ''
  const haystack = `${labelText} ${skill.prompt || ''}`.toLowerCase()
  return !NON_INDEXABLE_SKILL_TERMS.some((term) => haystack.includes(term))
}
