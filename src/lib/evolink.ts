/**
 * Evolink SeeDance 2.0 Video API Client
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
  quality?: string           // 720p (default) / 480p
  generateAudio?: boolean    // default true
  videoUrls?: string[]       // 0-3 reference videos
  audioUrls?: string[]       // 0-3 reference audios
}

export interface EvolinkTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

/** Create a SeeDance video generation task via Evolink. Returns taskId. */
export async function createEvolinkTask(input: EvolinkTaskInput): Promise<string> {
  if (!API_KEY) {
    throw new Error('EVOLINK_API_KEY not configured')
  }

  const { prompt, images, duration, aspectRatio, quality, generateAudio, videoUrls, audioUrls } = input

  const hasMedia = images.length > 0 || (videoUrls && videoUrls.length > 0)
  const model = hasMedia
    ? 'seedance-2.0-fast-reference-to-video'
    : 'seedance-2.0-fast-text-to-video'

  const payload: Record<string, unknown> = {
    model,
    prompt,
    generate_audio: generateAudio ?? true,
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
