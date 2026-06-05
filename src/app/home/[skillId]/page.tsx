import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import type { Metadata } from 'next'

type Props = { params: Promise<{ skillId: string }> }

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

export default async function SkillDetailPage({ params }: Props) {
  const { skillId } = await params
  const { data } = await getSupabaseAdmin()
    .from('home_skills')
    .select('id')
    .eq('id', skillId)
    .eq('is_active', true)
    .single()

  if (!data) redirect('/home')
  redirect(`/home?skill=${skillId}`)
}
