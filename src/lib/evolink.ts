/**
 * Evolink Seedance 2.0 / 2.5 Video API Client
 *
 * Evolink wraps Volcengine SeeDance with real human face support.
 * API Docs: https://docs.evolink.ai/en/api-manual/video-series/seedance2.0/seedance-2.0-overview
 */

const BASE_URL = 'https://api.evolink.ai'
const API_KEY = process.env.EVOLINK_API_KEY

export interface EvolinkTaskInput {
  prompt: string
  images: string[]           // 0-9 public URLs
  duration?: number          // 4-15 (omit for default 5)
  aspectRatio?: string       // adaptive/16:9/9:16/1:1/4:3/3:4/21:9
  quality?: string           // 480p / 720p / 1080p depending on model
  model?: string
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
  if (!API_KEY) {
    throw new Error('EVOLINK_API_KEY not configured')
  }

  const { prompt, images, duration, aspectRatio, quality, model: requestedModel, generateAudio, videoUrls, audioUrls, contentFilter, outputFormat, webSearch } = input

  const hasReferenceMedia = images.length > 0 || !!videoUrls?.length || !!audioUrls?.length
  const model = requestedModel || (hasReferenceMedia
    ? 'seedance-2.0-fast-reference-to-video'
    : 'seedance-2.0-fast-text-to-video')
  const isSeedance25 = model.startsWith('seedance-2.5-')

  if (isSeedance25) {
    if (images.length > 30) throw new Error('Seedance 2.5 supports at most 30 reference images per request.')
    if ((videoUrls?.length || 0) > 10) throw new Error('Seedance 2.5 supports at most 10 reference videos per request.')
    if ((audioUrls?.length || 0) > 10) throw new Error('Seedance 2.5 supports at most 10 reference audio files per request.')
    if (images.length + (videoUrls?.length || 0) + (audioUrls?.length || 0) > 50) {
      throw new Error('Seedance 2.5 supports at most 50 total reference assets per request.')
    }
  }

  if (images.length > 0) {
    const { validateSeedanceImageReferences } = await import('./provider-image-reference')
    const failure = await validateSeedanceImageReferences(images)
    if (failure) throw new EvolinkInputError(failure)
  }

  const payload: Record<string, unknown> = {
    model,
    prompt,
    generate_audio: generateAudio ?? true,
  }

  if (isSeedance25) {
    payload.content_filter = contentFilter ?? true
    payload.output_format = outputFormat ?? 'mp4'
    if (webSearch) payload.model_params = { web_search: true }
  }

  if (images.length > 0) payload.image_urls = images
  if (videoUrls?.length) payload.video_urls = videoUrls
  if (audioUrls?.length) payload.audio_urls = audioUrls
  if (duration != null) payload.duration = duration
  if (aspectRatio) payload.aspect_ratio = aspectRatio
  if (quality) payload.quality = quality

  console.log(`[evolink] Creating task: model=${model}, ${images.length} images${videoUrls?.length ? ` + ${videoUrls.length} videos` : ''}${audioUrls?.length ? ` + ${audioUrls.length} audios` : ''}, duration=${duration ?? 'default'}, ratio=${aspectRatio ?? 'default'}`)

  const response = await fetch(`${BASE_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[evolink] ${response.status}: ${errorText.slice(0, 300)}`)
    throw new Error(`Evolink API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const taskId = data.id

  if (!taskId) {
    throw new Error(`Evolink API did not return task id: ${JSON.stringify(data)}`)
  }

  console.log(`[evolink] Task created: ${taskId}`)
  return taskId
}

/** Query an Evolink task for status + result. */
export async function getEvolinkTask(taskId: string): Promise<EvolinkTaskResult> {
  if (!API_KEY) {
    throw new Error('EVOLINK_API_KEY not configured')
  }

  const response = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Evolink status query error ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  const status: EvolinkTaskResult['status'] =
    data.status === 'completed' ? 'completed'
    : data.status === 'failed' ? 'failed'
    : data.status === 'processing' ? 'processing'
    : 'pending'

  const videoUrl = data.results?.[0] || undefined
  const error = data.error?.message || undefined

  return { taskId, status, videoUrl, error }
}
