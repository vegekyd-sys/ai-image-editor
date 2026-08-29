import { transcodeVideoBufferToSdrMp4 } from '@/lib/provider-video-reference'
import type { VideoGenerationOperation, VideoResolution } from '@/lib/video-model-capabilities'

export const GOOGLE_OMNI_MODEL = 'gemini-omni-1.1-flash'
const GOOGLE_OMNI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MAX_FETCH_BYTES = 55 * 1024 * 1024
export const GOOGLE_OMNI_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
export const GOOGLE_OMNI_TIMEOUT_ERROR = 'Google Omni video generation timed out after 10 minutes. Please regenerate the video.'

export interface GoogleOmniVideoTaskInput {
  prompt: string
  images: string[]
  duration?: number
  aspectRatio?: string
  resolution?: Extract<VideoResolution, '360p' | '720p' | '1080p' | '4k'>
  operation?: VideoGenerationOperation
  videoUrl?: string
  videoUrls?: string[]
}

export interface GoogleOmniVideoTaskResult {
  taskId: string
  status: 'completed' | 'failed'
  videoUrl?: string
  error?: string
  duration?: number
}

export function isGoogleOmniPlaceholderExpired(createdAt?: string | null, now = Date.now()): boolean {
  if (!createdAt) return false
  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) return false
  return now - createdAtMs >= GOOGLE_OMNI_REQUEST_TIMEOUT_MS
}

function normalizeGoogleOmniFetchError(error: unknown): Error {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name)
    : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(GOOGLE_OMNI_TIMEOUT_ERROR)
  }
  return error instanceof Error ? error : new Error(String(error))
}

function getGoogleApiKey(): string {
  const key = process.env.GOOGLE_API_KEY?.trim().replace(/\\n$/, '')
  if (!key) throw new Error('GOOGLE_API_KEY not configured')
  return key
}

export function normalizeGoogleOmniMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized === 'video/quicktime') return 'video/mov'
  return normalized
}

function contentTypeToMime(contentType: string | null, fallback: string): string {
  return normalizeGoogleOmniMimeType(contentType?.split(';')[0]?.trim() || fallback)
}

function extensionMime(url: string): string {
  const clean = url.split('?')[0]?.toLowerCase() || ''
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.mp4')) return 'video/mp4'
  if (clean.endsWith('.mov')) return 'video/mov'
  if (clean.endsWith('.webm')) return 'video/webm'
  return 'image/jpeg'
}

async function fetchAsBase64(
  url: string,
  fallbackMime?: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string; bytes: number }> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (error) {
    throw normalizeGoogleOmniFetchError(error)
  }
  if (!res.ok) throw new Error(`Failed to fetch reference media ${res.status}: ${url}`)

  const contentLength = Number(res.headers.get('content-length') || 0)
  if (contentLength > MAX_FETCH_BYTES) {
    throw new Error(`Reference media is too large (${(contentLength / 1024 / 1024).toFixed(1)}MB). Google Omni inline upload limit in Makaron is 55MB.`)
  }

  let buffer: Buffer<ArrayBufferLike> = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_FETCH_BYTES) {
    throw new Error(`Reference media is too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Google Omni inline upload limit in Makaron is 55MB.`)
  }
  let mimeType = contentTypeToMime(res.headers.get('content-type'), fallbackMime || extensionMime(url))
  if (mimeType === 'video/mov') {
    console.log('[google-omni] transcoding MOV reference to SDR MP4 before provider upload')
    buffer = await transcodeVideoBufferToSdrMp4(buffer)
    if (buffer.length > MAX_FETCH_BYTES) {
      throw new Error(`Transcoded reference media is too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Google Omni inline upload limit in Makaron is 55MB.`)
    }
    mimeType = 'video/mp4'
  }

  return {
    data: buffer.toString('base64'),
    mimeType,
    bytes: buffer.length,
  }
}

function findOutputVideo(obj: unknown): { uri?: string; data?: string; mime_type?: string; mimeType?: string } | null {
  if (!obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  const type = record.type
  const mime = record.mime_type || record.mimeType
  if (
    (type === 'video' || (typeof mime === 'string' && mime.startsWith('video/'))) &&
    (typeof record.uri === 'string' || typeof record.data === 'string')
  ) {
    return record as { uri?: string; data?: string; mime_type?: string; mimeType?: string }
  }
  if (record.output_video && typeof record.output_video === 'object') {
    return record.output_video as { uri?: string; data?: string; mime_type?: string; mimeType?: string }
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findOutputVideo(item)
        if (found) return found
      }
    } else if (value && typeof value === 'object') {
      const found = findOutputVideo(value)
      if (found) return found
    }
  }
  return null
}

function toOmniPrompt(
  prompt: string,
  imageCount: number,
  hasVideoReference: boolean,
  operation: VideoGenerationOperation,
  duration?: number,
): string {
  const useFirstFrame = imageCount === 1 && !hasVideoReference
  const normalized = prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (_, n: string) => {
    const index = Number(n)
    return useFirstFrame ? `Image${index}` : `<IMAGE_REF_${Math.max(0, index - 1)}>`
  })
  const declarations = []
  const guidance = []

  if (hasVideoReference) {
    declarations.push('[# Sources <VIDEO_0>@Video1]')
    guidance.push(operation === 'extend'
      ? 'Continue Video1 forward from its tail. Preserve its visual style, subject identity, motion, camera direction, lighting, and audio continuity unless the prompt explicitly changes them.'
      : 'Use Video1 as the primary source video to edit.')
  } else if (useFirstFrame) {
    declarations.push('[# Sources <FIRST_FRAME>@Image1]')
    guidance.push('Use Image1 as the starting frame.')
  }

  if (!useFirstFrame && imageCount > 0) {
    const refs = Array.from({ length: imageCount }, (_, index) => `<IMAGE_REF_${index}>@Image${index + 1}`).join(' ')
    declarations.push(`[# References ${refs}]`)
    guidance.push('Use the given images as references for video generation, not as literal initial frames.')
  }

  const parts = [declarations.join(' '), normalized, guidance.join(' ')].filter(Boolean)
  if (duration) parts.push(`Target duration: ${duration} seconds.`)
  return parts.join('\n\n')
}

function normalizeAspectRatio(aspectRatio?: string): '9:16' | '16:9' | undefined {
  if (aspectRatio === '9:16' || aspectRatio === '16:9') return aspectRatio
  return undefined
}

export async function createGoogleOmniVideoTask(input: GoogleOmniVideoTaskInput): Promise<GoogleOmniVideoTaskResult> {
  const key = getGoogleApiKey()
  const requestSignal = AbortSignal.timeout(GOOGLE_OMNI_REQUEST_TIMEOUT_MS)
  const videoRefs = [...(input.videoUrl ? [input.videoUrl] : []), ...(input.videoUrls || [])].filter(Boolean)
  if (videoRefs.length > 1) {
    throw new Error('Google Omni supports one reference video per Makaron request. Split multi-video workflows into separate tasks.')
  }

  const imageParts = []
  for (const imageUrl of input.images.filter(Boolean)) {
    if (!imageUrl.startsWith('http')) continue
    const image = await fetchAsBase64(imageUrl, undefined, requestSignal)
    imageParts.push({ type: 'image', data: image.data, mime_type: image.mimeType })
  }

  const videoRef = videoRefs[0]
  const operation = input.operation || 'generate'
  if ((operation === 'edit' || operation === 'extend') && !videoRef) {
    throw new Error(`Google Omni ${operation} requires one source video.`)
  }
  const prompt = toOmniPrompt(input.prompt, imageParts.length, Boolean(videoRef), operation, input.duration)
  const task = videoRef
    ? operation === 'extend' ? 'extend' : 'edit'
    : imageParts.length > 1 ? 'reference_to_video' : imageParts.length > 0 ? 'image_to_video' : 'text_to_video'
  const responseFormat: Record<string, unknown> = {
    type: 'video',
    delivery: 'uri',
    resolution: input.resolution || '720p',
  }
  const aspectRatio = normalizeAspectRatio(input.aspectRatio)
  if (aspectRatio && task !== 'edit' && task !== 'extend') responseFormat.aspect_ratio = aspectRatio

  let requestInput: unknown
  if (videoRef) {
    const video = await fetchAsBase64(videoRef, 'video/mp4', requestSignal)
    requestInput = [{
      type: 'user_input',
      content: [
        { type: 'video', mime_type: video.mimeType, data: video.data },
        ...imageParts,
        { type: 'text', text: task === 'extend' ? prompt : `${prompt}\n\nKeep everything else the same unless explicitly requested.` },
      ],
    }]
  } else {
    requestInput = [
      ...imageParts,
      { type: 'text', text: prompt },
    ]
  }

  let res: Response
  try {
    res = await fetch(GOOGLE_OMNI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        model: GOOGLE_OMNI_MODEL,
        input: requestInput,
        response_format: responseFormat,
        generation_config: {
          video_config: { task },
        },
        store: true,
        stream: false,
      }),
      signal: requestSignal,
    })
  } catch (error) {
    throw normalizeGoogleOmniFetchError(error)
  }

  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const error = data.error as { message?: string } | undefined
    throw new Error(`Google Omni API error ${res.status}: ${error?.message || text.slice(0, 800)}`)
  }

  const outputVideo = findOutputVideo(data)
  const uri = outputVideo?.uri
  const inlineData = outputVideo?.data
  if (!uri && !inlineData) {
    throw new Error(`Google Omni did not return a video output: ${JSON.stringify(data).slice(0, 800)}`)
  }

  const interactionId = typeof data.id === 'string' ? data.id : crypto.randomUUID()
  if (inlineData) {
    const fileUrl = `data:${outputVideo?.mime_type || outputVideo?.mimeType || 'video/mp4'};base64,${inlineData}`
    return { taskId: `google-omni-${interactionId}`, status: 'completed', videoUrl: fileUrl }
  }

  return {
    taskId: `google-omni-${interactionId}`,
    status: 'completed',
    videoUrl: uri,
  }
}

export async function getGoogleOmniVideoTask(taskId: string, videoUrl?: string): Promise<GoogleOmniVideoTaskResult> {
  if (videoUrl) {
    return { taskId, status: 'completed', videoUrl }
  }
  return {
    taskId,
    status: 'failed',
    error: 'Google Omni task is synchronous and no provider URL was saved. Please regenerate the video.',
  }
}

export async function fetchGoogleOmniVideoBytes(videoUrl: string): Promise<Uint8Array> {
  if (videoUrl.startsWith('data:')) {
    const [, payload] = videoUrl.split(',', 2)
    if (!payload) throw new Error('Invalid data URL from Google Omni')
    return new Uint8Array(Buffer.from(payload, 'base64'))
  }

  const headers: Record<string, string> = {}
  if (videoUrl.startsWith('https://generativelanguage.googleapis.com/')) {
    headers['x-goog-api-key'] = getGoogleApiKey()
  }
  const url = videoUrl.startsWith('https://generativelanguage.googleapis.com/') && !videoUrl.includes(':download')
    ? (videoUrl.includes('?') ? `${videoUrl}&alt=media` : `${videoUrl}?alt=media`)
    : videoUrl
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Omni video download failed ${res.status}: ${text.slice(0, 500)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}
