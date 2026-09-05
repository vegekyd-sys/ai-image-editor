/** FAL H3 Max reference and native text generation adapter.
 * Contract checked 2026-09-05: https://fal.ai/models/minimax/h3-max/reference-to-video/api
 */
import { validateProviderImages } from './provider-image-preflight'
import type { FalH3MaxResolution } from './fal-h3-max-video'

export const H3_MAX_REFERENCE_ENDPOINT = 'minimax/h3-max/reference-to-video'

export interface H3MaxReferenceInput {
  prompt: string
  images: string[]
  videos?: Array<{ url: string; durationSec: number }>
  audios?: Array<{ url: string; durationSec: number }>
  duration?: number
  resolution?: FalH3MaxResolution
  aspectRatio?: string
  seed?: number
  onBeforeSubmit?: () => Promise<void>
  /** Internal only: createVideo already measured and validated the selected images. */
  imagesVerified?: boolean
}

function validateClips(clips: Array<{ durationSec: number }>, kind: string): void {
  if (clips.some(clip => !Number.isFinite(clip.durationSec) || clip.durationSec < 2 || clip.durationSec > 15)) {
    throw new Error(`H3 Max reference ${kind} clips must each be 2-15 seconds.`)
  }
  if (clips.reduce((sum, clip) => sum + clip.durationSec, 0) > 15) {
    throw new Error(`H3 Max reference ${kind} duration must total at most 15 seconds.`)
  }
}

export function buildH3MaxReferencePayload(input: H3MaxReferenceInput): Record<string, unknown> {
  const { images, videos = [], audios = [] } = input
  const duration = input.duration ?? 5
  if (!input.prompt.trim() || input.prompt.length > 50_000) throw new Error('H3 Max reference prompt must contain 1-50000 characters.')
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error('H3 Max reference output must be an integer from 5 to 15 seconds.')
  if (images.length > 9 || videos.length > 3 || audios.length > 3 || images.length + videos.length + audios.length > 12) {
    throw new Error('H3 Max supports at most 9 images, 3 videos, 3 audios, and 12 total reference files.')
  }
  if (audios.length && !images.length && !videos.length) throw new Error('H3 Max reference requires at least one image or video; audio alone is unsupported.')
  validateClips(videos, 'video')
  validateClips(audios, 'audio')
  // Live 2026-09-05: audio data URIs are materialized as .bin and rejected.
  // Upload with the real filename/content type before entering this adapter.
  if (audios.some(clip => !clip.url.startsWith('https://'))) throw new Error('H3 Max reference audio requires an HTTPS file URL with a supported audio filename; upload data URIs first.')
  const resolution = input.resolution ?? '768p'
  if (!['480p', '768p'].includes(resolution)) throw new Error('H3 Max reference resolution must be 480p or 768p.')
  const aspectRatio = !input.aspectRatio || input.aspectRatio === 'auto' ? 'adaptive' : input.aspectRatio
  if (!['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(aspectRatio)) throw new Error('Unsupported H3 Max reference aspect ratio.')
  const counts = { image: images.length, media: images.length, video: videos.length, audio: audios.length }
  const prompt = input.prompt.trim().replace(/<<<(image|media|video|audio)_(\d+)>>>/gi, (_, kind: string, raw: string) => {
    const type = kind.toLowerCase() as keyof typeof counts
    const index = Number(raw)
    if (index < 1 || index > counts[type]) throw new Error(`Reference marker ${kind}_${raw} has no matching input.`)
    const label = type === 'media' || type === 'image' ? 'Image' : type === 'video' ? 'Video' : 'Audio'
    return `${label} ${index}`
  })
  return {
    prompt, duration, resolution: resolution.toUpperCase(), aspect_ratio: aspectRatio,
    reference_image_urls: images, reference_video_urls: videos.map(clip => clip.url),
    reference_audio_urls: audios.map(clip => clip.url),
    enable_safety_checker: true, prompt_expansion_mode: 'balanced', sync_mode: false,
    ...(input.seed != null ? { seed: input.seed } : {}),
  }
}

export async function createFalH3MaxReferenceVideoTask(input: H3MaxReferenceInput): Promise<string> {
  const payload = buildH3MaxReferencePayload(input)
  const hasReferences = input.images.length > 0 || Boolean(input.videos?.length)
  if (!hasReferences) {
    delete payload.reference_image_urls
    delete payload.reference_video_urls
    delete payload.reference_audio_urls
    if (payload.aspect_ratio === 'adaptive') payload.aspect_ratio = '16:9'
  }
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('FAL_KEY not configured')
  if (!input.imagesVerified) await validateProviderImages(input.images, 'fal-h3-max')
  await input.onBeforeSubmit?.()
  const response = await fetch(`https://queue.fal.run/${input.images.length || input.videos?.length ? H3_MAX_REFERENCE_ENDPOINT : 'minimax/h3-max/text-to-video'}`, {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  // Do not expose upstream error bodies: they may echo signed inputs.
  if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
    const { H3ReferenceInputError } = await import('./h3-reference-preflight')
    throw new H3ReferenceInputError(`FAL H3 Max rejected submission (HTTP ${response.status}); no provider task was accepted.`)
  }
  if (!response.ok) throw new Error(`H3 Max reference submission HTTP ${response.status}; no automatic resubmission.`)
  if (typeof body.request_id !== 'string' || !body.request_id) throw new Error('H3 Max reference submission outcome unknown; no automatic resubmission.')
  return `fal-h3max-reference-${body.request_id}`
}

/** Research quote, not customer billing. Official reference-input formula:
 * https://fal.ai/learn/tools/how-to-use-minimax-h3-max
 * Video examples use 37,296 tokens per 5s at 768p (the prose rounds to 7,459/s).
 */
export function estimateH3MaxReferenceCost(input: {
  duration: number; resolution: FalH3MaxResolution
  images: Array<{ width: number; height: number }>
  videoSeconds: number; audioSeconds: number
}) {
  const values = [input.duration, input.videoSeconds, input.audioSeconds, ...input.images.flatMap(image => [image.width, image.height])]
  if (values.some(value => !Number.isFinite(value) || value < 0) || input.duration <= 0 || input.images.some(image => image.width <= 0 || image.height <= 0)) throw new Error('Cost estimate requires measured positive dimensions and nonnegative durations.')
  const referenceTokens = input.images.reduce((sum, image) => sum + image.width * image.height / 1024, 0)
    + input.videoSeconds * (input.resolution === '480p' ? 2886 : 37296 / 5)
    + input.audioSeconds * 80
  const outputUsd = input.duration * (input.resolution === '480p' ? 0.05 : 0.08)
  const referenceUsd = Math.max(0, referenceTokens - 4096) * 0.02 / 1000
  return { outputUsd, referenceTokens, referenceUsd, totalUsd: outputUsd + referenceUsd, estimatedCreditsAt2x: Math.ceil((outputUsd + referenceUsd) * 200 - 1e-9) }
}
