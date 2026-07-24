import type { NextRequest } from 'next/server'
import { detectPreferredLocale, matchSupportedLocale, parseAcceptLanguage, type Locale } from '@/lib/locales'

export type AppLocale = Locale

export function resolveRequestLocale(
  cookieLocale: string | null | undefined,
  acceptLanguage: string | null | undefined,
  fallback: AppLocale = 'en',
): AppLocale {
  const matchedCookie = matchSupportedLocale(cookieLocale)
  if (matchedCookie) return matchedCookie

  return detectPreferredLocale(parseAcceptLanguage(acceptLanguage), fallback)
}

export function getRequestLocale(req: NextRequest, fallback: AppLocale = 'en'): AppLocale {
  return resolveRequestLocale(
    req.cookies.get('locale')?.value,
    req.headers.get('accept-language'),
    fallback,
  )
}
