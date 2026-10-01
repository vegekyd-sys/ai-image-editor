import { getSupabaseAdmin } from '@/lib/supabase/service'
import type { Metadata } from 'next'
import { getOptimizedUrl } from '@/lib/supabase/storage'
import { createClient } from '@/lib/supabase/server'
import { resolveNativeVideoPlaybackUrl } from '@/lib/video-playback-url'
import ProjectEntryPreview from '@/components/ProjectEntryPreview'
import type { VideoMeta } from '@/types'

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
  // Use the viewer's session and RLS for early media, including private projects.
  const supabase = await createClient()
  const { data } = await supabase
    .from('snapshots')
    .select('image_url, type, video_meta, design_path')
    .eq('project_id', id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const lcpUrl = data?.image_url && data.image_url !== '/video-placeholder.png'
    ? getOptimizedUrl(data.image_url) : null
  const videoMeta = data?.video_meta as VideoMeta | null
  // Edited compositions open their persisted poster, rather than the raw source video.
  const videoSource = data?.type === 'video' && !data.design_path ? videoMeta?.videoUrl : null
  const range = videoMeta?.sourceRange
  const videoUrl = videoSource
    ? `${resolveNativeVideoPlaybackUrl(videoSource).split('#')[0]}#t=${range?.start_sec || 0.001}${range ? `,${range.end_sec}` : ''}`
    : null

  return (
    <>
      <ProjectEntryPreview projectId={id} imageUrl={lcpUrl} videoUrl={videoUrl} />
      {children}
    </>
  )
}
