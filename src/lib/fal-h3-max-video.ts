const FAL_QUEUE_BASE = 'https://queue.fal.run/minimax/h3-max'
const TEXT_ENDPOINT = 'minimax/h3-max/text-to-video'
const IMAGE_ENDPOINT = 'minimax/h3-max/image-to-video'
const TASK_PREFIX = 'fal-h3max-'

export type FalH3MaxResolution = '480p' | '768p'

export interface FalH3MaxTaskInput {
  prompt: string
  images: string[]
  duration?: number
  aspectRatio?: string
  resolution?: FalH3MaxResolution
}

export interface FalH3MaxTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

function apiKey(): string {
  const value = process.env.FAL_KEY?.trim()
  if (!value) throw new Error('FAL_KEY not configured')
  return value
}

function headers(): Record<string, string> {
  return {
    Authorization: `Key ${apiKey()}`,
    'Content-Type': 'application/json',
  }
}

function rawRequestId(taskId: string): string {
  return taskId.startsWith(TASK_PREFIX) ? taskId.slice(TASK_PREFIX.length) : taskId
}

function providerResolution(resolution?: FalH3MaxResolution): '480P' | '768P' {
  return resolution === '768p' ? '768P' : '480P'
}

function normalizePrompt(prompt: string): string {
  return prompt.replace(/<<<(?:image|media)_\d+>>>/gi, 'the provided first frame')
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.detail === 'string') return body.detail
  if (typeof body.error === 'string') return body.error
  if (body.error && typeof body.error === 'object') {
    const message = (body.error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return fallback
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(`${label} error ${response.status}: ${errorMessage(body, JSON.stringify(body))}`)
  }
  return body
}

export async function createFalH3MaxVideoTask(input: FalH3MaxTaskInput): Promise<string> {
  const prompt = input.prompt.trim()
  const images = input.images || []
  const duration = input.duration ?? 5

  if (!prompt) throw new Error('MiniMax H3 Max requires a non-empty prompt.')
  if (images.length > 1) throw new Error('MiniMax H3 Max currently supports exactly one start image, not multi-image references.')
  if (![5, 10, 15].includes(duration)) throw new Error('MiniMax H3 Max duration must be one of 5, 10, or 15 seconds.')

  const endpoint = images.length === 1 ? IMAGE_ENDPOINT : TEXT_ENDPOINT
  const payload: Record<string, unknown> = {
    prompt: normalizePrompt(prompt),
    duration,
    resolution: providerResolution(input.resolution),
    enable_safety_checker: true,
    prompt_expansion_mode: 'balanced',
    sync_mode: false,
  }

  if (images.length === 1) {
    payload.image_url = images[0]
  } else {
    payload.aspect_ratio = input.aspectRatio && input.aspectRatio !== 'auto'
      ? input.aspectRatio
      : '16:9'
  }

  const response = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
  const body = await readJson(response, 'MiniMax H3 Max submit')
  const requestId = typeof body.request_id === 'string' ? body.request_id : ''
  if (!requestId) throw new Error(`MiniMax H3 Max did not return request_id: ${JSON.stringify(body)}`)
  return `${TASK_PREFIX}${requestId}`
}

export async function getFalH3MaxVideoTask(taskId: string): Promise<FalH3MaxTaskResult> {
  const requestId = rawRequestId(taskId)
  const authHeaders = { Authorization: `Key ${apiKey()}` }
  const statusResponse = await fetch(`${FAL_QUEUE_BASE}/requests/${encodeURIComponent(requestId)}/status`, {
    headers: authHeaders,
  })
  const statusBody = await readJson(statusResponse, 'MiniMax H3 Max status')
  const providerStatus = typeof statusBody.status === 'string' ? statusBody.status : ''

  if (providerStatus === 'IN_QUEUE') return { taskId, status: 'pending' }
  if (providerStatus === 'IN_PROGRESS') return { taskId, status: 'processing' }
  if (providerStatus === 'FAILED') {
    return {
      taskId,
      status: 'failed',
      error: errorMessage(statusBody, 'MiniMax H3 Max generation failed.'),
    }
  }
  if (providerStatus !== 'COMPLETED') return { taskId, status: 'processing' }

  const resultResponse = await fetch(`${FAL_QUEUE_BASE}/requests/${encodeURIComponent(requestId)}`, {
    headers: authHeaders,
  })
  const resultBody = await readJson(resultResponse, 'MiniMax H3 Max result') as {
    video?: { url?: unknown }
  }
  const videoUrl = typeof resultBody.video?.url === 'string' ? resultBody.video.url : undefined
  if (!videoUrl) {
    return { taskId, status: 'failed', error: 'MiniMax H3 Max completed without a video URL.' }
  }
  return { taskId, status: 'completed', videoUrl }
}
