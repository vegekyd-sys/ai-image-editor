import { Suspense } from 'react'
import ProjectEditorContainer from '@/components/ProjectEditorContainer'
import ProjectEntryPreview from '@/components/ProjectEntryPreview'
import { readEntryMedia, readOpeningLayers } from '@/lib/editor/project-layer-entry.server'
import { playerLayerSources } from '@/lib/editor/layer-preview'
import { getOptimizedUrl } from '@/lib/supabase/storage'
import { resolveNativeVideoPlaybackUrl } from '@/lib/video-playback-url'
import type { VideoMeta } from '@/types'

async function EarlyProjectMedia({ media, projectId }: { media: ReturnType<typeof readEntryMedia>; projectId: string }) {
  const data = (await media)?.row
  const lcpUrl = data?.image_url && data.image_url !== '/video-placeholder.png'
    ? getOptimizedUrl(data.image_url) : null
  const videoMeta = data?.video_meta as VideoMeta | null
  // Edited compositions open their persisted poster, rather than the raw source video.
  const videoSource = data?.type === 'video' && !data.design_path ? videoMeta?.videoUrl : null
  const range = videoMeta?.sourceRange
  const videoUrl = videoSource
    ? `${resolveNativeVideoPlaybackUrl(videoSource).split('#')[0]}#t=${range?.start_sec || 0.001}${range ? `,${range.end_sec}` : ''}`
    : null

  return <ProjectEntryPreview projectId={projectId} imageUrl={lcpUrl} videoUrl={videoUrl} />
}

async function LayerPreloads({ entry }: { entry: ReturnType<typeof readOpeningLayers> }) {
  const opening = await entry
  if (!opening) return null
  const urls = new Set(playerLayerSources(opening.design)?.values())
  return Array.from(urls, href => <link key={href} rel="preload" as="fetch" crossOrigin="anonymous" href={href} />)
}

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ snapshot?: string | string[] }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const snapshotId = (Array.isArray(query.snapshot) ? query.snapshot[0] : query.snapshot) || null
  const media = readEntryMedia(id, snapshotId).catch(() => null)
  const opening = readOpeningLayers(id, media)
  return <>
    <Suspense fallback={null}><EarlyProjectMedia media={media} projectId={id} /></Suspense>
    <Suspense fallback={null}><LayerPreloads entry={opening} /></Suspense>
    <ProjectEditorContainer key={id} projectId={id} initialSnapshotId={snapshotId} openingLayers={opening} />
  </>
}
