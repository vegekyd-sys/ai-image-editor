import { extractRetakeSourceFrame } from './video-retake-media'

export interface ExtractVideoFrameOptions {
  timestamp?: number
  quality?: number
}

/**
 * Extract one visual frame from a real video file URL.
 * This is for uploaded/generated MP4/MOV/WebM media, not Remotion compositions.
 */
export async function extractVideoFrame(videoUrl: string, options: ExtractVideoFrameOptions = {}): Promise<Buffer> {
  const timestamp = Number.isFinite(options.timestamp) ? Math.max(0, Number(options.timestamp)) : 0.5
  const quality = Number.isFinite(options.quality) ? Math.max(2, Math.min(31, Number(options.quality))) : 4

  const res = await fetch(videoUrl)
  if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) throw new Error('Downloaded video is empty')
  // Use the same measured visual tail as local editing. Container duration
  // may include audio after the last actual video frame.
  return extractRetakeSourceFrame(buffer,timestamp,quality)
}
