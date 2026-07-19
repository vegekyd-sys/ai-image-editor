const XAI_BASE_URL = process.env.XAI_API_BASE || 'https://api.x.ai'
const XAI_VIDEO_MODEL = 'grok-imagine-video-1.5'
const XAI_DEFAULT_RESOLUTION = (process.env.XAI_VIDEO_RESOLUTION || '480p') as '480p' | '720p'

export interface XaiVideoTaskInput {
  prompt: string
  images: string[]
  duration?: number
  aspectRatio?: string
  resolution?: '480p' | '720p'
}

export interface XaiVideoTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
  duration?: number
  costUsd?: number
  progress?: number
}

function getApiKey(): string {
  const key = process.env.XAI_API_KEY?.trim() || process.env.X_AI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim()
  if (!key) throw new Error('XAI_API_KEY not configured')
  return key
}

function headers() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

function toXaiPrompt(prompt: string): string {
  return prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (_, n: string) => {
    return n === '1' ? 'the source image' : `reference ${n}`
  })
}

function normalizeStatus(status?: string): XaiVideoTaskResult['status'] {
  if (status === 'done') return 'completed'
  if (status === 'failed' || status === 'expired') return 'failed'
  if (status === 'queued' || status === 'pending') return 'pending'
  return 'processing'
}

function extractError(data: Record<string, unknown>): string | undefined {
  const error = data.error
  if (!error) {
    return typeof data.message === 'string' ? data.message : undefined
  }
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return JSON.stringify(error)
}

function parseResponseObject(text: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(text)
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function isTerminalStatusResponse(status: number): boolean {
  // xAI reports terminal generation failures such as content moderation as
  // HTTP 400 responses from the task status endpoint. Missing/expired tasks
  // are terminal too. Authentication, throttling, and 5xx errors must keep
  // throwing so the normal retry/operations path can recover them.
  return status === 400 || status === 404 || status === 410 || status === 422
}

function dollarsFromUsage(data: Record<string, unknown>): number | undefined {
  const usage = data.usage as Record<string, unknown> | undefined
  const ticks = Number(usage?.cost_in_usd_ticks)
  if (!Number.isFinite(ticks)) return undefined
  return ticks / 10_000_000_000
}

export async function createXaiVideoTask(input: XaiVideoTaskInput): Promise<string> {
  if (input.images.length < 1) {
    throw new Error('Grok Video requires at least one image.')
  }
  if (input.images.length > 1) {
    throw new Error('Grok Video 1.5 supports exactly one source image in Makaron. Choose Kling or SeeDance for multi-image/video reference generation.')
  }

  const resolution = input.resolution || XAI_DEFAULT_RESOLUTION
  const body: Record<string, unknown> = {
    model: XAI_VIDEO_MODEL,
    prompt: toXaiPrompt(input.prompt),
    image: { url: input.images[0] },
    duration: input.duration ?? 6,
    resolution,
  }

  // Do not send aspect_ratio for xAI image-to-video. xAI documents that forcing
  // a ratio different from the source image stretches the image content.

  const res = await fetch(`${XAI_BASE_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`xAI video API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const requestId = data?.request_id
  if (!requestId) {
    throw new Error(`xAI video API did not return request_id: ${JSON.stringify(data)}`)
  }
  return `xai-${requestId}`
}

export async function getXaiVideoTask(taskId: string): Promise<XaiVideoTaskResult> {
  const requestId = taskId.startsWith('xai-') ? taskId.slice(4) : taskId
  const res = await fetch(`${XAI_BASE_URL}/v1/videos/${requestId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })

  if (!res.ok) {
    const text = await res.text()
    const data = parseResponseObject(text)
    if (isTerminalStatusResponse(res.status)) {
      return {
        taskId: `xai-${requestId}`,
        status: 'failed',
        error: (data && extractError(data)) || text.slice(0, 500) || `xAI video generation failed (${res.status})`,
        costUsd: data ? dollarsFromUsage(data) : undefined,
      }
    }
    throw new Error(`xAI video status error ${res.status}: ${text}`)
  }

  const data = await res.json() as Record<string, unknown>
  const video = data.video as Record<string, unknown> | undefined
  return {
    taskId: `xai-${requestId}`,
    status: normalizeStatus(String(data.status || 'processing')),
    videoUrl: typeof video?.url === 'string' ? video.url : undefined,
    error: extractError(data),
    duration: Number.isFinite(Number(video?.duration)) ? Number(video?.duration) : undefined,
    costUsd: dollarsFromUsage(data),
    progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : undefined,
  }
}
