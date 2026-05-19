import { getSupabaseAdmin } from '@/lib/supabase/service'
import type { Metadata } from 'next'
import { getOptimizedUrl } from '@/lib/supabase/storage'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const { data } = await getSupabaseAdmin()
    .from('projects')
    .select('title, cover_url, is_public')
    .eq('id', id)
    .eq('is_public', true)
    .single()

  if (!data) return {}

  const title = `${data.title || 'Untitled'} - Makaron`
  return {
    title,
    openGraph: {
      title,
      images: data.cover_url ? [{ url: data.cover_url }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: data.cover_url ? [data.cover_url] : [],
    },
  }
}

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data } = await getSupabaseAdmin()
    .from('snapshots')
    .select('image_url')
    .eq('project_id', id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const lcpUrl = data?.image_url ? getOptimizedUrl(data.image_url) : null

  return (
    <>
      {lcpUrl && (
        <head>
          <link rel="preload" as="image" href={lcpUrl} fetchPriority="high" />
        </head>
      )}
      {children}
    </>
  )
}
