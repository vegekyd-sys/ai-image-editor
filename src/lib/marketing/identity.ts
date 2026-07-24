export const MARKETING_ANONYMOUS_ID_KEY = 'mkr_anonymous_id'

export function getOrCreateMarketingAnonymousId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const existing = localStorage.getItem(MARKETING_ANONYMOUS_ID_KEY)
    if (existing) return existing
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
    const next = `anon.${Date.now()}.${random}`
    localStorage.setItem(MARKETING_ANONYMOUS_ID_KEY, next)
    return next
  } catch {
    return undefined
  }
}
