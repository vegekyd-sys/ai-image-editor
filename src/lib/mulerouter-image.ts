/**
 * MuleRouter CarrotHub image client for the Spicy image family.
 *
 * Official contracts:
 * https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/qwen-image-edit-spicy/generation
 * https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/z-image-spicy/generation
 */

const BASE_URL = 'https://api.mulerouter.ai'
const QWEN_EDIT_PATH = '/vendors/carrothub/v1/qwen-image-edit-spicy/generation'
const Z_IMAGE_PATH = '/vendors/carrothub/v1/z-image-spicy/generation'
const DEFAULT_TIMEOUT_MS = 5 * 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024

type MuleRouterImageStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface MuleRouterImageTask {
  task_info?: {
    id?: string
    status?: MuleRouterImageStatus
    error?: {
      code?: number
      title?: string
      detail?: string
    }
  }
  images?: string[]
  error?: unknown
}

function getApiKey(): string {
  const key = process.env.MULEROUTER_API_KEY?.trim()
  if (!key) throw new Error('MULEROUTER_API_KEY not configured')
  return key
}

function getPositiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readError(data: MuleRouterImageTask): string | undefined {
  const taskError = data.task_info?.error
  if (taskError) return taskError.detail || taskError.title || JSON.stringify(taskError)
  if (typeof data.error === 'string') return data.error
  if (data.error) return JSON.stringify(data.error)
  return undefined
}

async function readResponseData(response: Response): Promise<MuleRouterImageTask> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as MuleRouterImageTask
  } catch {
    return { error: raw.slice(0, 1_000) }
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function safeGetWithRetry(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(250 * attempt)
    }
  }
  const parsed = new URL(url)
  const cause = lastError instanceof Error && 'cause' in lastError
    ? (lastError.cause as { code?: string } | undefined)
    : undefined
  throw new Error(`GET ${parsed.origin}${parsed.pathname} failed${cause?.code ? ` (${cause.code})` : ''}`)
}

async function createTask(path: string, payload: Record<string, unknown>): Promise<string> {
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await readResponseData(response)
  if (!response.ok) {
    throw new Error(`MuleRouter image API error ${response.status}: ${readError(data) || JSON.stringify(data)}`)
  }
  const taskId = data.task_info?.id
  if (!taskId) throw new Error(`MuleRouter image API did not return task id: ${JSON.stringify(data)}`)
  return taskId
}

async function deleteTask(path: string, taskId: string): Promise<void> {
  if (process.env.MULEROUTER_IMAGE_DELETE_TASKS === 'false') return
  try {
    await fetchWithTimeout(`${BASE_URL}${path}/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getApiKey()}` },
    }, 15_000)
  } catch (error) {
    console.warn('[mulerouter-image] Task cleanup failed:', error instanceof Error ? error.message : error)
  }
}

async function waitForTask(path: string, taskId: string): Promise<string> {
  const timeoutMs = getPositiveEnvNumber('MULEROUTER_IMAGE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
  const pollIntervalMs = getPositiveEnvNumber('MULEROUTER_IMAGE_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS)
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const response = await safeGetWithRetry(`${BASE_URL}${path}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    })
    const data = await readResponseData(response)
    if (!response.ok) {
      throw new Error(`MuleRouter image task query error ${response.status}: ${readError(data) || JSON.stringify(data)}`)
    }

    const status = data.task_info?.status
    if (status === 'completed') {
      const imageUrl = data.images?.[0]
      if (!imageUrl) throw new Error(`MuleRouter image task ${taskId} completed without an image URL`)
      return imageUrl
    }
    if (status === 'failed') {
      throw new Error(`MuleRouter image task ${taskId} failed: ${readError(data) || 'unknown provider error'}`)
    }
    if (status !== 'pending' && status !== 'processing') {
      throw new Error(`MuleRouter image task ${taskId} returned unexpected status: ${String(status)}`)
    }
    await sleep(pollIntervalMs)
  }

  throw new Error(`MuleRouter image task ${taskId} timed out after ${timeoutMs}ms`)
}

async function downloadImageAsDataUrl(url: string): Promise<string> {
  // Retrying an output GET is safe and avoids losing a completed paid task to
  // a transient CDN/TLS failure. Generation POSTs are never retried here.
  const response = await safeGetWithRetry(url, {}, 60_000)
  if (!response.ok) throw new Error(`MuleRouter output download failed: HTTP ${response.status}`)

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (!contentType?.startsWith('image/')) {
    throw new Error(`MuleRouter output is not an image: ${contentType || 'missing content-type'}`)
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_OUTPUT_BYTES) {
    throw new Error(`MuleRouter output is too large: ${contentLength} bytes`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error('MuleRouter output image is empty')
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`MuleRouter output is too large: ${bytes.length} bytes`)
  return `data:${contentType};base64,${bytes.toString('base64')}`
}

async function runTask(path: string, payload: Record<string, unknown>): Promise<string> {
  const startedAt = Date.now()
  const taskId = await createTask(path, payload)
  console.log(`[mulerouter-image] created ${path.includes('qwen') ? 'qwen-edit-spicy' : 'z-image-spicy'} task ${taskId}`)
  try {
    const imageUrl = await waitForTask(path, taskId)
    const image = await downloadImageAsDataUrl(imageUrl)
    console.log(`[mulerouter-image] ${path.includes('qwen') ? 'qwen-edit-spicy' : 'z-image-spicy'} completed in ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`)
    return image
  } finally {
    await deleteTask(path, taskId)
  }
}

function dimensionsForAspectRatio(aspectRatio?: string): { width: number; height: number } {
  const match = aspectRatio?.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return { width: 1024, height: 1024 }
  const ratio = Number(match[1]) / Number(match[2])
  if (!Number.isFinite(ratio) || ratio <= 0) return { width: 1024, height: 1024 }

  const longSide = 1536
  const shortSide = Math.max(256, Math.round(longSide / Math.max(ratio, 1 / ratio)))
  return ratio >= 1
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide }
}

export function isMuleRouterImageAvailable(): boolean {
  return Boolean(process.env.MULEROUTER_API_KEY?.trim())
}

export function muleRouterQwenInputs(input: { image?: string; references?: { url: string }[] }): string[] {
  return [
    ...(input.image ? [input.image] : []),
    ...(input.references?.map(reference => reference.url) ?? []),
  ]
}

export function supportsMuleRouterQwenRequest(input: { image?: string; references?: { url: string }[] }): boolean {
  const images = muleRouterQwenInputs(input)
  return images.length <= 3
}

export async function generateWithMuleRouterQwenEdit(images: string[], prompt: string): Promise<string> {
  if (images.length < 1 || images.length > 3) {
    throw new Error('Qwen Image Edit Spicy requires 1-3 input images')
  }
  return runTask(QWEN_EDIT_PATH, {
    image: images[0],
    ...(images.length > 1 ? { reference_images: images.slice(1) } : {}),
    prompt,
  })
}

export async function generateWithMuleRouterZImage(prompt: string, aspectRatio?: string): Promise<string> {
  const dimensions = dimensionsForAspectRatio(aspectRatio)
  return runTask(Z_IMAGE_PATH, {
    prompt,
    ...dimensions,
    // Makaron already supplies a detailed generation prompt. Rewriting costs an
    // extra API call and can weaken prompt fidelity, so it is opt-in here.
    prompt_extend: process.env.MULEROUTER_Z_IMAGE_PROMPT_EXTEND === 'true',
  })
}
