export interface HomeSkill {
  id: string
  labels: Record<string, string>
  image: string
  prompt: string
  skill_path?: string | null
  image_count?: number
  sort_order: number
  is_active?: boolean
  updated_at?: string
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
