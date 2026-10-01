'use client'

import { useEffect, useState } from 'react'
import { buildVideoProxyUrl } from '@/lib/video-playback-url'

export interface ProjectEntryPreviewProps {
  projectId: string
  imageUrl: string | null
  videoUrl?: string | null
}

/** Keep the early media visible until the editor has decoded its own canvas. */
export default function ProjectEntryPreview({ projectId, imageUrl, videoUrl }: ProjectEntryPreviewProps) {
  const [ready, setReady] = useState(false)
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null)
  const previewVideoUrl = videoUrl && failedVideoUrl === videoUrl
    ? `${buildVideoProxyUrl(videoUrl.split('#')[0])}${videoUrl.includes('#') ? `#${videoUrl.split('#')[1]}` : ''}`
    : videoUrl
  useEffect(() => {
    const checkCanvas = () => {
      const canvas = document.querySelector(`[data-project-canvas="${projectId}"]`)
      if (canvas?.getAttribute('data-canvas-ready') === 'true') setReady(true)
    }
    checkCanvas()
    document.addEventListener('makaron:canvas-ready', checkCanvas)
    return () => document.removeEventListener('makaron:canvas-ready', checkCanvas)
  }, [projectId])

  if (ready || (!imageUrl && !videoUrl)) return null
  return (
    <div id="ssr-skeleton" data-project-entry-preview={projectId} className="fixed inset-0 z-[2] pointer-events-none" style={{ height: '100dvh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full h-full flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center bg-black p-[2px]">
            {videoUrl ? (
              <video
                src={previewVideoUrl ?? undefined}
                crossOrigin="anonymous"
                poster={imageUrl ?? undefined}
                preload="auto" muted playsInline
                onError={() => {
                  if (!videoUrl.startsWith('/api/proxy-video?')) setFailedVideoUrl(videoUrl)
                }}
                className="w-full h-full object-contain"
              />
            ) : (
              <img src={imageUrl!} alt="" className="w-full h-full object-contain" fetchPriority="high" />
            )}
          </div>
          <div className="flex-shrink-0 h-[166px] lg:h-[146px]" />
        </div>
        <div className="hidden lg:block flex-shrink-0" style={{ width: 500 }} />
      </div>
    </div>
  )
}
