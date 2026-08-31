/**
 * MuleRouter CarrotHub video client for Wan 3.0 Standard and Pro.
 *
 * Official contracts:
 * https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/w3.0-video/generation
 * https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/berry-1.0-pro/generation
 */

const BASE_URL = 'https://api.mulerouter.ai'
const STANDARD_PATH = '/vendors/carrothub/v1/w3.0-video/generation'
const PRO_PATH = '/vendors/carrothub/v1/berry-1.0-pro/generation'
const STANDARD_TASK_PREFIX = 'mr-wan30-'
const PRO_TASK_PREFIX = 'mr-wan30-pro-'

export type MuleRouterWanModel = 'standard' | 'pro'

export interface MuleRouterVideoTaskInput {
  model: MuleRouterWanModel
  prompt: string
  images: string[]
  videoUrls?: string[]
  audioUrls?: string[]
  duration?: number
  aspectRatio?: string
  resolution: '480p' | '720p' | '1080p' | '2k' | '4k'
  generateAudio?: boolean
  promptExtend?: boolean
  seed?: number
}

export interface MuleRouterVideoTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

function getApiKey(): string {
  const key = process.env.MULEROUTER_API_KEY
  if (!key) throw new Error('MULEROUTER_API_KEY not configured')
  return key
}

function getPath(model: MuleRouterWanModel): string {
  return model === 'pro' ? PRO_PATH : STANDARD_PATH
}

function wrapTaskId(model: MuleRouterWanModel, providerTaskId: string): string {
  return `${model === 'pro' ? PRO_TASK_PREFIX : STANDARD_TASK_PREFIX}${providerTaskId}`
}

function parseTaskId(taskId: string): { model: MuleRouterWanModel; providerTaskId: string } {
  if (taskId.startsWith(PRO_TASK_PREFIX)) {
    return { model: 'pro', providerTaskId: taskId.slice(PRO_TASK_PREFIX.length) }
  }
  if (taskId.startsWith(STANDARD_TASK_PREFIX)) {
    return { model: 'standard', providerTaskId: taskId.slice(STANDARD_TASK_PREFIX.length) }
  }
  throw new Error(`Unsupported MuleRouter task id: ${taskId}`)
}

function readError(data: any): string | undefined {
  const error = data?.task_info?.error || data?.error
  if (!error) return undefined
  return error.detail || error.message || error.title || (typeof error === 'string' ? error : JSON.stringify(error))
}

async function readResponseData(response: Response): Promise<any> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { error: raw }
  }
}

export function isMuleRouterVideoTask(taskId?: string | null): boolean {
  return !!taskId && (taskId.startsWith(STANDARD_TASK_PREFIX) || taskId.startsWith(PRO_TASK_PREFIX))
}

export async function createMuleRouterVideoTask(input: MuleRouterVideoTaskInput): Promise<string> {
  const { model, prompt, images, videoUrls = [], audioUrls = [] } = input
  if (images.length > 10) throw new Error('Wan 3.0 supports at most 10 reference images per request.')
  if (videoUrls.length > 5) throw new Error('Wan 3.0 supports at most 5 reference videos per request.')
  if (audioUrls.length > 5) throw new Error('Wan 3.0 supports at most 5 reference audio files per request.')
  if (images.length + videoUrls.length + audioUrls.length > 20) {
    throw new Error('Wan 3.0 supports at most 20 total reference assets per request.')
  }

  const isSingleImageKeyframe = images.length === 1 && videoUrls.length === 0 && audioUrls.length === 0
  const payload: Record<string, unknown> = {
    prompt: isSingleImageKeyframe ? prompt.replace(/\bImage 1\b/gi, 'the first frame') : prompt,
    resolution: input.resolution,
    ratio: input.aspectRatio || 'adaptive',
    audio: input.generateAudio ?? true,
    prompt_extend: input.promptExtend ?? true,
  }
  if (input.duration != null) payload.duration = input.duration
  if (input.seed != null) payload.seed = input.seed

  // A single image is an opening keyframe. Mixed or multi-reference requests
  // use reference mode; MuleRouter explicitly forbids mixing these two modes.
  if (isSingleImageKeyframe) {
    payload.first_frame = images[0]
  } else {
    if (images.length) payload.reference_images = images
    if (videoUrls.length) payload.reference_videos = videoUrls
    if (audioUrls.length) payload.reference_audios = audioUrls
  }

  console.log(`[mulerouter] Creating ${model} Wan task: ${images.length} images, ${videoUrls.length} videos, ${audioUrls.length} audios, duration=${input.duration ?? 'smart'}, resolution=${input.resolution}`)
  const response = await fetch(`${BASE_URL}${getPath(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await readResponseData(response)
  if (!response.ok) {
    throw new Error(`MuleRouter API error ${response.status}: ${readError(data) || JSON.stringify(data)}`)
  }
  const providerTaskId = data?.task_info?.id
  if (!providerTaskId) throw new Error(`MuleRouter API did not return task id: ${JSON.stringify(data)}`)
  return wrapTaskId(model, providerTaskId)
}

export async function getMuleRouterVideoTask(taskId: string): Promise<MuleRouterVideoTaskResult> {
  const { model, providerTaskId } = parseTaskId(taskId)
  const response = await fetch(`${BASE_URL}${getPath(model)}/${providerTaskId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })
  const data = await readResponseData(response)
  if (!response.ok) {
    throw new Error(`MuleRouter status query error ${response.status}: ${readError(data) || JSON.stringify(data)}`)
  }

  const providerStatus = data?.task_info?.status
  const status: MuleRouterVideoTaskResult['status'] =
    providerStatus === 'completed' ? 'completed'
      : providerStatus === 'failed' ? 'failed'
        : providerStatus === 'processing' ? 'processing'
          : 'pending'
  return {
    taskId,
    status,
    videoUrl: Array.isArray(data?.videos) ? data.videos[0] : undefined,
    error: readError(data),
  }
}
