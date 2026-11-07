import { VideoProviderRejection } from './video-provider-error'
import { transcodeVideoBufferToSdrMp4 } from '@/lib/provider-video-reference'
import type { VideoGenerationOperation, VideoResolution } from '@/lib/video-model-capabilities'

export const GOOGLE_OMNI_MODEL = 'gemini-omni-1.2-flash'
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
  /** Continue or edit a Google-generated video in the same interaction lineage, without re-uploading it. */
  previousInteractionId?: string
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

/**
 * Omni 1.2 deprecates control tokens such as <IMAGE_REF_0> / <FIRST_FRAME> and
 * reads media roles from natural language, so Makaron markers become
 * "Image N" / "the source video" with an explicit role sentence.
 * imageSlots[i] is the ordinal of media_(i+1) among uploaded images (0 = not an image).
 */
export function toOmniPrompt(
  prompt: string,
  imageSlots: number[],
  hasVideoReference: boolean,
  hasPreviousInteraction: boolean,
  operation: VideoGenerationOperation,
): string {
  const imageCount = Math.max(0, ...imageSlots)
  const normalized = prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (_, n: string) => {
    const ordinal = imageSlots[Number(n) - 1]
    if (ordinal) return `Image ${ordinal}`
    return hasVideoReference || hasPreviousInteraction ? 'the source video' : ''
  }).replace(/[ \t]{2,}/g, ' ').trim()
  const guidance = []

  if (operation === 'extend') {
    guidance.push(`${hasVideoReference ? 'Continue the attached source video' : 'Continue the video from the previous turn'} forward from its last frame. Preserve its visual style, subject identity, motion, camera direction, lighting, and audio continuity unless the prompt explicitly changes them.`)
  } else if (hasVideoReference) {
    guidance.push('Edit the attached source video. Keep everything not mentioned in the request unchanged: framing, timing, motion, characters, and audio.')
  } else if (hasPreviousInteraction) {
    guidance.push('Edit the video from the previous turn. Keep everything not mentioned in the request unchanged: framing, timing, motion, characters, and audio.')
  }

  if (imageCount > 0) {
    const names = Array.from({ length: imageCount }, (_, index) => `Image ${index + 1}`).join(', ')
    guidance.push(`The attached images are, in order, ${names}. Use them as references for character, product, and style identity, not as literal first frames.`)
  }

  return [normalized, guidance.join(' ')].filter(Boolean).join('\n\n')
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
  const imageSlots: number[] = []
  for (const imageUrl of input.images) {
    if (!imageUrl?.startsWith('http')) { imageSlots.push(0); continue }
    const image = await fetchAsBase64(imageUrl, undefined, requestSignal)
    imageParts.push({ type: 'image', data: image.data, mime_type: image.mimeType })
    imageSlots.push(imageParts.length)
  }

  const videoRef = videoRefs[0]
  const operation = input.operation || 'generate'
  const previousInteractionId = input.previousInteractionId?.trim()
  if ((operation === 'edit' || operation === 'extend') && !videoRef && !previousInteractionId) {
    throw new Error(`Google Omni ${operation} requires one source video.`)
  }
  if (previousInteractionId && operation !== 'extend' && operation !== 'edit') {
    throw new Error('Google Omni previousInteractionId is only supported for video edit or extension in Makaron.')
  }
  if (previousInteractionId && videoRef) {
    throw new Error('Google Omni uses either a previous interaction or one uploaded source video, not both.')
  }
  const prompt = toOmniPrompt(input.prompt, imageSlots, Boolean(videoRef), Boolean(previousInteractionId), operation)
  const task = previousInteractionId
    ? operation
    : videoRef
    ? operation === 'extend' ? 'extend' : 'edit'
    : imageParts.length > 0 ? 'reference_to_video' : 'text_to_video'
  const responseFormat: Record<string, unknown> = {
    type: 'video',
    delivery: 'uri',
    resolution: input.resolution || '720p',
  }
  // 1.2 takes duration as a typed field ("3s".."15s") that overrides any
  // length written in the prompt. Edits keep the source length.
  if (input.duration && task !== 'edit') {
    responseFormat.duration = `${Math.round(input.duration)}s`
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
        { type: 'text', text: prompt },
      ],
    }]
  } else if (previousInteractionId) {
    requestInput = imageParts.length > 0
      ? [...imageParts, { type: 'text', text: prompt }]
      : prompt
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
        ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
        response_format: responseFormat,
        ...(!previousInteractionId ? {
          generation_config: {
            video_config: { task },
          },
        } : {}),
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
    const message = `Google Omni API error ${res.status}: ${error?.message || text.slice(0, 800)}`
    if (res.status >= 400 && res.status < 500 && res.status !== 408) throw new VideoProviderRejection(message)
    throw new Error(message)
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
