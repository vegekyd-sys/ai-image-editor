'use client'

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import LayerLoadingHint from './LayerLoadingHint'
import { buildVideoProxyUrl } from '@/lib/video-playback-url'
import { getTransparencyCrossOrigin } from '@/lib/image/transparency'

export interface ProjectEntryPreviewProps {
  projectId: string
  imageUrl: string | null
  videoUrl?: string | null
}

/** Keep the early media visible until the editor has decoded its own canvas. */
export default function ProjectEntryPreview({ projectId, imageUrl, videoUrl }: ProjectEntryPreviewProps) {
  const [readyProjectId, setReadyProjectId] = useState<string | null>(null)
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null)
  const [mountedCanvas, setMountedCanvas] = useState<{ projectId: string; element: Element } | null>(null)
  const previewVideoUrl = videoUrl && failedVideoUrl === videoUrl
    ? `${buildVideoProxyUrl(videoUrl.split('#')[0])}${videoUrl.includes('#') ? `#${videoUrl.split('#')[1]}` : ''}`
    : videoUrl
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => checkCanvas())
    const checkCanvas = () => {
      const canvas = document.querySelector(`[data-project-canvas="${projectId}"]`)
      if (canvas) {
        setMountedCanvas(current => current?.projectId === projectId && current.element === canvas
          ? current : { projectId, element: canvas })
        observer.disconnect()
      }
      if (canvas?.getAttribute('data-canvas-ready') === 'true') setReadyProjectId(projectId)
    }
    observer.observe(document.body, { childList: true, subtree: true })
    checkCanvas()
    document.addEventListener('makaron:canvas-ready', checkCanvas)
    return () => { observer.disconnect(); document.removeEventListener('makaron:canvas-ready', checkCanvas) }
  }, [projectId])

  if (readyProjectId === projectId || (!imageUrl && !videoUrl)) return null
  const media = videoUrl ? (
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
    <img src={imageUrl!} crossOrigin={getTransparencyCrossOrigin(imageUrl!)} alt="" className="w-full h-full object-contain" fetchPriority="high" />
  )
  const content = <>{imageUrl?.includes('/layerize/') && <LayerLoadingHint />}{media}</>
  // Once the real canvas mounts, use its exact box and clipping. The early
  // full-screen estimate must not continue covering the editor's controls.
  if (mountedCanvas?.projectId === projectId) {
    return createPortal(
      <div id="ssr-skeleton" data-project-entry-preview={projectId}
        className="absolute inset-0 z-[16] pointer-events-none overflow-hidden flex items-center justify-center bg-black">
        {content}
      </div>,
      mountedCanvas.element,
    )
  }
  return (
    <div id="ssr-skeleton" data-project-entry-preview={projectId} className="fixed inset-0 z-[2] pointer-events-none" style={{ height: '100dvh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full h-full flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center bg-black p-[2px]">
            {content}
          </div>
          <div className="flex-shrink-0 h-[166px] lg:h-[146px]" />
        </div>
        <div className="hidden lg:block flex-shrink-0" style={{ width: 500 }} />
      </div>
    </div>
  )
}
