import type { NextRequest } from 'next/server'

export type AppLocale = 'zh' | 'en'

export function getRequestLocale(req: NextRequest, fallback: AppLocale = 'en'): AppLocale {
  const cookieLocale = req.cookies.get('locale')?.value
  if (cookieLocale === 'zh' || cookieLocale === 'en') return cookieLocale

  const acceptLanguage = req.headers.get('accept-language') || ''
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() || ''
  if (first.startsWith('zh')) return 'zh'
  if (first) return 'en'
  return fallback
}
