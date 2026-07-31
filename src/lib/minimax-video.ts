const MINIMAX_BASE_URL = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com'
const MINIMAX_MODEL = 'MiniMax-H3'
const TASK_PREFIX = 'minimax-h3-'

export type MinimaxVideoResolution = '768p' | '2k'

export interface MinimaxVideoTaskInput {
  prompt: string
  images: string[]
  videoUrls?: string[]
  audioUrls?: string[]
  duration?: number
  aspectRatio?: string
  resolution?: MinimaxVideoResolution
}

export interface MinimaxVideoTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
  duration?: number
  resolution?: string
  usage?: {
    totalSeconds?: number
    inputSeconds?: number
    outputSeconds?: number
    inputImageCount?: number
  }
}

function getApiKey(): string {
  const key = process.env.MINIMAX_API_KEY?.trim()
  if (!key) throw new Error('MINIMAX_API_KEY not configured')
  return key
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

function providerResolution(resolution?: MinimaxVideoResolution): '768P' | '2K' {
  return resolution === '768p' ? '768P' : '2K'
}

function normalizePrompt(prompt: string): string {
  return prompt
    .replace(/<<<(?:image|media)_(\d+)>>>/gi, 'reference image $1')
    .replace(/<<<audio_(\d+)>>>/gi, 'reference audio $1')
}

function rawTaskId(taskId: string): string {
  return taskId.startsWith(TASK_PREFIX) ? taskId.slice(TASK_PREFIX.length) : taskId
}

function extractApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const record = data as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return typeof record.message === 'string' ? record.message : fallback
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
  } catch {
    // Keep the provider's HTTP status useful even if an upstream proxy returns HTML.
  }
  if (!response.ok) {
    throw new Error(`MiniMax video API error ${response.status}: ${extractApiError(data, text.slice(0, 500) || response.statusText)}`)
  }
  return data
}

export async function createMinimaxVideoTask(input: MinimaxVideoTaskInput): Promise<string> {
  const images = input.images || []
  const videoUrls = input.videoUrls || []
  const audioUrls = input.audioUrls || []

  if (!input.prompt.trim()) throw new Error('MiniMax H3 requires a non-empty prompt.')
  if (images.length > 9) throw new Error('MiniMax H3 supports at most 9 reference images per request.')
  if (videoUrls.length > 3) throw new Error('MiniMax H3 supports at most 3 reference videos per request.')
  if (audioUrls.length > 3) throw new Error('MiniMax H3 supports at most 3 reference audio files per request.')
  if (audioUrls.length > 0 && images.length === 0 && videoUrls.length === 0) {
    throw new Error('MiniMax H3 reference audio requires at least one reference image or video.')
  }
  if (images.length + videoUrls.length + audioUrls.length > 12) {
    throw new Error('MiniMax H3 supports at most 12 reference files per request.')
  }

  const hasReferenceMedia = images.length > 0 || videoUrls.length > 0 || audioUrls.length > 0
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: normalizePrompt(input.prompt) },
    ...images.map(url => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
    ...videoUrls.map(url => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })),
    ...audioUrls.map(url => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })),
  ]

  const payload = {
    model: MINIMAX_MODEL,
    content,
    resolution: providerResolution(input.resolution),
    duration: input.duration ?? 5,
    ratio: input.aspectRatio && input.aspectRatio !== 'auto'
      ? input.aspectRatio
      : hasReferenceMedia ? 'adaptive' : '16:9',
    aigc_watermark: false,
  }

  const response = await fetch(`${MINIMAX_BASE_URL}/v2/video_generation`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
  const data = await readJson(response)
  const taskId = data.task_id
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error(`MiniMax video API did not return task_id: ${JSON.stringify(data)}`)
  }
  return `${TASK_PREFIX}${taskId}`
}

function normalizeStatus(status: unknown): MinimaxVideoTaskResult['status'] {
  if (status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'failed'
  if (status === 'queued') return 'pending'
  return 'processing'
}

export async function getMinimaxVideoTask(taskId: string): Promise<MinimaxVideoTaskResult> {
  const providerTaskId = rawTaskId(taskId)
  const response = await fetch(`${MINIMAX_BASE_URL}/v2/query/video_generation/${encodeURIComponent(providerTaskId)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })
  const data = await readJson(response)
  const task = data.task as Record<string, unknown> | undefined
  if (!task) throw new Error(`MiniMax video status response missing task: ${JSON.stringify(data)}`)

  const content = task.content as Record<string, unknown> | undefined
  const error = task.error as Record<string, unknown> | undefined
  const usage = task.usage as Record<string, unknown> | undefined
  const numberOrUndefined = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined

  return {
    taskId: `${TASK_PREFIX}${providerTaskId}`,
    status: normalizeStatus(task.status),
    videoUrl: typeof content?.url === 'string' ? content.url : undefined,
    error: typeof error?.message === 'string' ? error.message : undefined,
    duration: numberOrUndefined(task.duration),
    resolution: typeof task.resolution === 'string' ? task.resolution : undefined,
    usage: usage ? {
      totalSeconds: numberOrUndefined(usage.total_seconds),
      inputSeconds: numberOrUndefined(usage.input_seconds),
      outputSeconds: numberOrUndefined(usage.output_seconds),
      inputImageCount: numberOrUndefined(usage.input_image_count),
    } : undefined,
  }
}
