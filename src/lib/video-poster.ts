import { createVideoDesign } from '@/lib/video-design'
import { renderDesignFrame } from '@/lib/remotion-server'

/**
 * Capture a poster frame from a video URL using Vercel Sandbox + Remotion.
 * Returns JPEG Buffer or null on failure.
 */
export async function captureVideoPoster(
  videoUrl: string,
  width: number,
  height: number,
  durationSec?: number,
): Promise<Buffer | null> {
  try {
    const design = createVideoDesign(videoUrl, width, height, durationSec || 10)
    return await renderDesignFrame(design, 15) // frame 15 = 0.5s at 30fps
  } catch (err) {
    console.error('[captureVideoPoster] Failed:', err)
    return null
  }
}
