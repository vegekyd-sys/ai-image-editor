import { buildMagi2Payload } from './magi2'
import { buildSeedance25FlashPayload } from './seedance25-flash'
/**
 * Evolink Seedance 2.0 / 2.5 Video API Client
 *
 * Shared client for Evolink-hosted Seedance model families.
 * Seedance API Docs: https://docs.evolink.ai/en/api-manual/video-series/seedance2.0/seedance-2.0-overview
 */

const BASE_URL = 'https://api.evolink.ai'
export function getEvolinkVideoApiKey(): string {
  const key = process.env.EVOLINK_API_KEY?.trim()
  if (!key) throw new Error('EVOLINK_API_KEY not configured')
  return key
}

export interface EvolinkTaskInput {
  prompt: string
  images: string[]           // public URLs; model-specific limits apply
  duration?: number          // model-specific range; omit for smart/default mode
  aspectRatio?: string       // adaptive/16:9/9:16/1:1/4:3/3:4/21:9
  quality?: string           // 480p / 720p / 1080p / 4k depending on model
  model?: string
  seed?: number              // MAGI-2 repeatability
  generateAudio?: boolean    // default true
  videoUrls?: string[]       // 0-3 reference videos; <=50MB, width/height 300-6000px, frame pixels 409,600-2,086,876
  audioUrls?: string[]       // 0-3 reference audios
  contentFilter?: boolean    // Seedance 2.5 default true; false costs 10% more
  outputFormat?: 'mp4' | 'mov'
  webSearch?: boolean        // Seedance 2.5 text-to-video only
}

export interface EvolinkTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
  errorCode?: string
}

/** An explicit rejected POST has no paid receipt to reconcile. Transport/5xx
 * failures remain ambiguous and must never authorize an automatic repost. */
export class EvolinkSubmissionError extends Error {
  readonly code = 'evolink_submission_rejected'
  constructor(readonly statusCode: number) {
    super(`Evolink rejected video submission (HTTP ${statusCode}); no provider task was accepted.`)
    this.name = 'EvolinkSubmissionError'
  }
}

export class EvolinkInputError extends Error {
  readonly code: string
  readonly retryable = false
  readonly repairable = true
  readonly terminal = false
  readonly reason: string
  readonly suggestedAction: string
  readonly userMessage: { en: string; zh: string }
  readonly invalidMediaUrls: string[]
  readonly details: Record<string, unknown>

  constructor(failure: {
    code: string
    reason: string
    message: string
    suggestedAction: string
    userMessage: { en: string; zh: string }
    invalidMediaUrls: string[]
    details: Record<string, unknown>
  }) {
    super(failure.message)
    this.name = 'EvolinkInputError'
    this.code = failure.code
    this.reason = failure.reason
    this.suggestedAction = failure.suggestedAction
    this.userMessage = failure.userMessage
    this.invalidMediaUrls = failure.invalidMediaUrls
    this.details = failure.details
  }
}

/** Create a SeeDance video generation task via Evolink. Returns taskId. */
export async function createEvolinkTask(input: EvolinkTaskInput): Promise<string> {
  const apiKey = getEvolinkVideoApiKey()

  const { prompt, images, duration, aspectRatio, quality, model: requestedModel, generateAudio, videoUrls, audioUrls, contentFilter, outputFormat, webSearch } = input

  const hasReferenceMedia = images.length > 0 || !!videoUrls?.length || !!audioUrls?.length
  const model = requestedModel || (hasReferenceMedia
    ? 'seedance-2.0-fast-reference-to-video'
    : 'seedance-2.0-fast-text-to-video')
  const isMagi2 = model.startsWith('magi-2-')
  const magiPayload = isMagi2 ? buildMagi2Payload({ ...input, model }) : undefined
  const isFlash = model.startsWith('seedance-2.5-flash-')
  const isSeedance25 = model.startsWith('seedance-2.5-') && !isFlash
  // Validate before fetching images or submitting any paid request.
  const flashPayload = isFlash ? buildSeedance25FlashPayload({ ...input, model }) : undefined
  const isSeedance = model.startsWith('seedance-')

  if (isSeedance25) {
    if (images.length > 30) throw new Error('Seedance 2.5 supports at most 30 reference images per request.')
    if ((videoUrls?.length || 0) > 10) throw new Error('Seedance 2.5 supports at most 10 reference videos per request.')
    if ((audioUrls?.length || 0) > 10) throw new Error('Seedance 2.5 supports at most 10 reference audio files per request.')
    if (images.length + (videoUrls?.length || 0) + (audioUrls?.length || 0) > 50) {
      throw new Error('Seedance 2.5 supports at most 50 total reference assets per request.')
    }
  }

  if (isSeedance && images.length > 0) {
    const { validateSeedanceImageReferences } = await import('./provider-image-reference')
    const failure = await validateSeedanceImageReferences(images)
    if (failure) throw new EvolinkInputError(failure)
  }

  const payload: Record<string, unknown> = magiPayload ?? flashPayload ?? {
    model,
    prompt,
    generate_audio: generateAudio ?? true,
  }

  if (isSeedance25) {
    payload.content_filter = contentFilter ?? true
    payload.output_format = outputFormat ?? 'mp4'
    if (webSearch) payload.model_params = { web_search: true }
  }

  if (!isFlash && !isMagi2) {
    if (images.length > 0) payload.image_urls = images
    if (videoUrls?.length) payload.video_urls = videoUrls
    if (audioUrls?.length) payload.audio_urls = audioUrls
    if (duration != null) payload.duration = duration
    if (aspectRatio) payload.aspect_ratio = aspectRatio
    if (quality) payload.quality = quality

  }

  console.log(`[evolink] Creating task: model=${model}, ${images.length} images${videoUrls?.length ? ` + ${videoUrls.length} videos` : ''}${audioUrls?.length ? ` + ${audioUrls.length} audios` : ''}, duration=${duration ?? 'default'}, ratio=${aspectRatio ?? 'default'}`)

  const response = await fetch(`${BASE_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    ...(isMagi2 ? { redirect: 'error' as const, signal: AbortSignal.timeout(25_000) } : {}),
  })

  if (!response.ok) {
    if ([400, 401, 402, 403, 404, 413, 415, 422, 429].includes(response.status)) {
      throw new EvolinkSubmissionError(response.status)
    }
    if (isMagi2) throw new Error(`EvoLink MAGI-2 submission HTTP ${response.status}; outcome unknown. Keep the original request for reconciliation.`)
    const errorText = await response.text()
    console.error(`[evolink] ${response.status}: ${errorText.slice(0, 300)}`)
    throw new Error(`Evolink API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const taskId = data.id

  if (isMagi2 && (typeof taskId !== 'string' || !/^task-unified-[\w-]+$/.test(taskId))) {
    throw new Error('EvoLink MAGI-2 task receipt missing; outcome unknown. Keep the original request for reconciliation.')
  }
  if (!taskId) {
    throw new Error(`Evolink API did not return task id: ${JSON.stringify(data)}`)
  }

  console.log(`[evolink] Task created: ${taskId}`)
  return taskId
}

/** Query an Evolink task for status + result. */
export async function getEvolinkTask(taskId: string): Promise<EvolinkTaskResult> {
  const apiKey = getEvolinkVideoApiKey()

  const response = await fetch(`${BASE_URL}/v1/tasks/${encodeURIComponent(taskId)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Evolink status query error ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  if (typeof data.model === 'string' && data.model.startsWith('magi-2-') && data.status === 'completed'
    && (typeof data.results?.[0] !== 'string' || !data.results[0].startsWith('https://'))) {
    throw new Error('EvoLink MAGI-2 completed without a playable video URL.')
  }
  const status: EvolinkTaskResult['status'] =
    data.status === 'completed' ? 'completed'
    : ['failed', 'cancelled', 'canceled'].includes(data.status) ? 'failed'
    : data.status === 'processing' ? 'processing'
    : 'pending'

  const videoUrl = data.results?.[0] || undefined
  const error = data.error?.message || undefined
  const errorCode = typeof data.error?.code === 'string' ? data.error.code : undefined

  return { taskId, status, videoUrl, error, ...(errorCode ? { errorCode } : {}) }
}
