import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import type { Metadata } from 'next'

type Props = {
  params: Promise<{ skillId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { skillId } = await params
  const { data } = await getSupabaseAdmin()
    .from('home_skills')
    .select('labels, image, prompt')
    .eq('id', skillId)
    .eq('is_active', true)
    .single()

  if (!data) return {}

  const title = data.labels?.en || data.labels?.zh || 'Makaron Skill'
  const desc = data.prompt?.slice(0, 160) || 'AI-powered creative skill'

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
