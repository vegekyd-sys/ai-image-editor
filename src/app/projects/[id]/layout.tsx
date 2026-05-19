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
      {/* SSR skeleton: matches Editor canvas layout exactly to avoid image position jump */}
      {lcpUrl && (
        <div id="ssr-skeleton" className="fixed inset-0 z-0 bg-black flex flex-col" style={{ width: '100%' }}>
          <div className="flex-1 min-h-0 flex items-center justify-center skeleton-canvas">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lcpUrl} alt="" className="w-full h-full object-contain" fetchPriority="high" />
          </div>
          <div className="h-[120px] flex-shrink-0 skeleton-bottom" />
          <style>{`
            @media (min-width: 1024px) {
              #ssr-skeleton { width: calc(100vw - 500px) !important; }
              .skeleton-bottom { height: 0px !important; }
            }
          `}</style>
        </div>
      )}
      {children}
    </>
  )
}
