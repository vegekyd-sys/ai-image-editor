import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { matchSupportedLocale, pickLocalizedValue } from '@/lib/locales'
import { resolveRequestLocale } from '@/lib/server-locale'
import type { Metadata } from 'next'

type Props = {
  params: Promise<{ skillId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { skillId } = await params
  const admin = getSupabaseAdmin()
  let { data, error } = await admin
    .from('home_skills')
    .select('labels, image, prompt, prompts')
    .eq('id', skillId)
    .eq('is_active', true)
    .single()

  // Keep deep-link previews working during a rolling deploy before the
  // additive prompts column reaches the shared database.
  if (error) {
    const legacy = await admin
      .from('home_skills')
      .select('labels, image, prompt')
      .eq('id', skillId)
      .eq('is_active', true)
      .single()
    data = legacy.data ? { ...legacy.data, prompts: {} } : null
    error = legacy.error
  }

  if (!data || error) return {}

  const [resolvedSearchParams, cookieStore, headerStore] = await Promise.all([
    searchParams,
    cookies(),
    headers(),
  ])
  const localeParam = resolvedSearchParams?.locale
  const queryLocale = matchSupportedLocale(Array.isArray(localeParam) ? localeParam[0] : localeParam)
  const locale = queryLocale ?? resolveRequestLocale(
    cookieStore.get('locale')?.value,
    headerStore.get('accept-language'),
  )

  const title = pickLocalizedValue(data.labels, locale, 'Makaron Skill')
  const desc = pickLocalizedValue(data.prompts, locale, data.prompt || '').slice(0, 160)
    || 'AI-powered creative skill'

  return {
    title: `${title} - Makaron`,
    description: desc,
    openGraph: {
      title: `${title} - Makaron`,
      description: desc,
      images: data.image ? [{ url: data.image }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} - Makaron`,
      description: desc,
      images: data.image ? [data.image] : [],
    },
  }
}

export default async function SkillDetailPage({ params, searchParams }: Props) {
  const { skillId } = await params
  const { data } = await getSupabaseAdmin()
    .from('home_skills')
    .select('id')
    .eq('id', skillId)
    .eq('is_active', true)
    .single()

  if (!data) redirect('/home')
  const resolvedSearchParams = await searchParams
  const query = new URLSearchParams()
  query.set('skill', skillId)
  for (const [key, value] of Object.entries(resolvedSearchParams ?? {})) {
    if (key === 'skill' || value === undefined) continue
    if (Array.isArray(value)) {
      value.forEach(v => query.append(key, v))
    } else {
      query.set(key, value)
    }
  }
  redirect(`/home?${query.toString()}`)
}
