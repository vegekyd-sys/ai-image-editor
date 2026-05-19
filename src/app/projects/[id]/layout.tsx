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
      {/* SSR skeleton: mirrors Editor layout exactly to prevent image position jump */}
      {lcpUrl && (
        <div id="ssr-skeleton" className="fixed inset-0 z-0 bg-black">
          {/* Desktop: flex-row (canvas left + CUI right). Mobile: flex-col (canvas + bottom bar) */}
          <div className="w-full h-full flex flex-col lg:flex-row">
            {/* Left: GUI panel (canvas + bottom bar) */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Canvas area */}
              <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lcpUrl} alt="" className="w-full h-full object-contain" fetchPriority="high" />
              </div>
              {/* Bottom bar: StatusBar (46) + TipsBar/VideoCard + CategoryTabs = 166px mobile, 146px desktop */}
              <div className="flex-shrink-0 h-[166px] lg:h-[146px]" />
            </div>
            {/* Right: CUI panel placeholder (desktop only) */}
            <div className="hidden lg:block flex-shrink-0 border-l border-white/[0.08]" style={{ width: 500 }} />
          </div>
        </div>
      )}
      {children}
    </>
  )
}
