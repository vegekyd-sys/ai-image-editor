import {
  fetchGrokSubscriptionRelay,
  GrokSubscriptionRelayError,
  isGrokSubscriptionAllowedUser,
  preflightGrokSubscriptionRelay,
} from './grok-subscription'

const XAI_BASE_URL = process.env.XAI_API_BASE || 'https://api.x.ai'
export const XAI_VIDEO_GENERATION_MODEL = 'grok-imagine-video-1.5'
export const XAI_VIDEO_EDIT_MODEL = 'grok-imagine-video'
const XAI_DEFAULT_RESOLUTION = (process.env.XAI_VIDEO_RESOLUTION || '480p') as XaiVideoResolution

export type XaiVideoOperation = 'generate' | 'edit' | 'extend'
export type XaiVideoResolution = '480p' | '720p' | '1080p'

export interface XaiVideoTaskInput {
  prompt: string
  images: string[]
  videoUrl?: string
  operation?: XaiVideoOperation
  duration?: number
  aspectRatio?: string
  resolution?: XaiVideoResolution
  generateAudio?: boolean
  referenceVoiceIds?: string[]
}

export interface XaiVideoSubmission {
  taskId: string
  providerModel: typeof XAI_VIDEO_GENERATION_MODEL | typeof XAI_VIDEO_EDIT_MODEL
  mode: 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'edit-video' | 'extend-video'
  provider: 'grok-subscription' | 'xai-api'
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

function toReferencePrompt(prompt: string): string {
  return prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (_, n: string) => `<IMAGE_${n}>`)
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

export async function createXaiVideoTask(
  input: XaiVideoTaskInput,
  options?: {
    userId?: string
    onBeforeApiFallback?: () => Promise<void>
  },
): Promise<XaiVideoSubmission> {
  const operation = input.operation || 'generate'
  const images = input.images.filter(Boolean)
  const referenceVoiceIds = (input.referenceVoiceIds || []).filter(Boolean)
  if (images.length > 7) {
    throw new Error('Grok Imagine Video 1.5 supports at most 7 reference images per request.')
  }
  if (referenceVoiceIds.length > 3) {
    throw new Error('Grok Imagine Video 1.5 supports at most 3 preset reference voices per request.')
  }

  let endpoint = '/v1/videos/generations'
  let providerModel: XaiVideoSubmission['providerModel'] = XAI_VIDEO_GENERATION_MODEL
  let mode: XaiVideoSubmission['mode']
  const body: Record<string, unknown> = {
    model: providerModel,
    prompt: input.prompt,
  }

  if (operation === 'edit' || operation === 'extend') {
    if (!input.videoUrl) {
      throw new Error(`Grok video ${operation} requires one source video.`)
    }
    if (images.length > 0 || referenceVoiceIds.length > 0) {
      throw new Error(`Grok video ${operation} cannot be combined with image or voice references.`)
    }
    endpoint = operation === 'edit' ? '/v1/videos/edits' : '/v1/videos/extensions'
    providerModel = XAI_VIDEO_EDIT_MODEL
    body.model = providerModel
    body.video = { url: input.videoUrl }
    mode = operation === 'edit' ? 'edit-video' : 'extend-video'
    if (operation === 'extend') body.duration = input.duration ?? 6
  } else {
    const resolution = input.resolution || XAI_DEFAULT_RESOLUTION
    body.duration = input.duration ?? 6
    body.resolution = resolution
    if (input.generateAudio != null) body.generate_audio = input.generateAudio

    if (images.length === 0 && referenceVoiceIds.length === 0) {
      mode = 'text-to-video'
      if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    } else {
      mode = 'reference-to-video'
      if (resolution === '1080p') {
        throw new Error('Grok reference-to-video is capped at 720p. Use 480p or 720p, or remove all image and voice references for native 1080p text-to-video.')
      }
      body.prompt = toReferencePrompt(input.prompt)
      if (images.length > 0) body.reference_images = images.map(url => ({ url }))
      if (referenceVoiceIds.length > 0) {
        body.reference_audios = referenceVoiceIds.map(voiceId => ({ voice_id: voiceId }))
      }
      if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    }
  }

  const bodyText = JSON.stringify(body)
  const bodyBytes = new TextEncoder().encode(bodyText)
  let res: Response
  let usedSubscription = false
  const useSubscription = await isGrokSubscriptionAllowedUser(options?.userId)
  if (useSubscription && options?.userId) {
    try {
      await preflightGrokSubscriptionRelay(options.userId)
      res = await fetchGrokSubscriptionRelay({
        method: 'POST',
        pathname: endpoint,
        userId: options.userId,
        body: bodyBytes,
      })
      usedSubscription = true
    } catch (error) {
      if (!(error instanceof GrokSubscriptionRelayError) || !error.safeToFallback) throw error
      await options.onBeforeApiFallback?.()
      res = await fetch(`${XAI_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: headers(),
        body: bodyText,
      })
    }
  } else {
    res = await fetch(`${XAI_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: headers(),
      body: bodyText,
    })
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`xAI video API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const requestId = data?.request_id
  if (!requestId) {
    throw new Error(`xAI video API did not return request_id: ${JSON.stringify(data)}`)
  }
  return {
    taskId: usedSubscription ? `xai-sub-${requestId}` : `xai-${requestId}`,
    providerModel,
    mode,
    provider: usedSubscription ? 'grok-subscription' : 'xai-api',
  }
}

export async function getXaiVideoTask(taskId: string, userId?: string): Promise<XaiVideoTaskResult> {
  const subscriptionTask = taskId.startsWith('xai-sub-')
  const requestId = subscriptionTask
    ? taskId.slice('xai-sub-'.length)
    : taskId.startsWith('xai-') ? taskId.slice(4) : taskId
  const res = subscriptionTask
    ? userId
      ? await fetchGrokSubscriptionRelay({
          method: 'GET',
          pathname: `/v1/videos/${requestId}`,
          userId,
        })
      : (() => { throw new Error('GROK_SUBSCRIPTION_RELAY_UNAVAILABLE: user id is required to poll a subscription task') })()
    : await fetch(`${XAI_BASE_URL}/v1/videos/${requestId}`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      })

  if (!res.ok) {
    const text = await res.text()
    const data = parseResponseObject(text)
    if (isTerminalStatusResponse(res.status)) {
      return {
        taskId: subscriptionTask ? `xai-sub-${requestId}` : `xai-${requestId}`,
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
    taskId: subscriptionTask ? `xai-sub-${requestId}` : `xai-${requestId}`,
    status: normalizeStatus(String(data.status || 'processing')),
    videoUrl: typeof video?.url === 'string' ? video.url : undefined,
    error: extractError(data),
    duration: Number.isFinite(Number(video?.duration)) ? Number(video?.duration) : undefined,
    costUsd: dollarsFromUsage(data),
    progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : undefined,
  }
}
