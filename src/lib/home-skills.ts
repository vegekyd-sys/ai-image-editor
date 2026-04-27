export interface HomeSkill {
  id: string
  labels: Record<string, string>
  image: string
  prompt: string
  skill_path?: string | null
  image_count?: number
  sort_order: number
  is_active?: boolean
}
