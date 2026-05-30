'use client'

export interface MarketingAttribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  skill_id?: string
  landing_path?: string
  first_seen_at?: string
}

const STORAGE_KEY = 'mkr_marketing_attribution'
const COOKIE_KEY = 'mkr_attribution'
const ATTR_TTL_SECONDS = 60 * 60 * 24 * 30

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

function readStoredAttribution(): MarketingAttribution {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as MarketingAttribution : {}
  } catch {
    return {}
  }
}

function writeCookie(value: MarketingAttribution) {
  try {
    const encoded = encodeURIComponent(JSON.stringify(value))
    document.cookie = `${COOKIE_KEY}=${encoded}; path=/; max-age=${ATTR_TTL_SECONDS}; SameSite=Lax`
  } catch {}
}

export function captureMarketingAttribution(pathname: string, searchParams: URLSearchParams): MarketingAttribution {
  if (typeof window === 'undefined') return {}

  const incoming: MarketingAttribution = {}
  for (const key of UTM_KEYS) {
    const value = searchParams.get(key)
    if (value) incoming[key] = value
  }

  const skillId = searchParams.get('skill') || (pathname.startsWith('/home/') ? pathname.split('/')[2] : '')
  if (skillId) incoming.skill_id = skillId

  const hasIncoming = Object.keys(incoming).length > 0
  const previous = readStoredAttribution()
  const next: MarketingAttribution = hasIncoming
    ? {
        ...previous,
        ...incoming,
        landing_path: previous.landing_path || `${pathname}${window.location.search}`,
        first_seen_at: previous.first_seen_at || new Date().toISOString(),
      }
    : previous

  if (Object.keys(next).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    writeCookie(next)
  }

  return next
}

export function getMarketingAttribution(): MarketingAttribution {
  const value = readStoredAttribution()
  if (Object.keys(value).length > 0) writeCookie(value)
  return value
}

export function getAttributionForRequest(): MarketingAttribution | undefined {
  const value = getMarketingAttribution()
  return Object.keys(value).length > 0 ? value : undefined
}
