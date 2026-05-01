/**
 * SeeDance 2.0 Video API Client (Volcengine Ark)
 *
 * API Docs: https://www.volcengine.com/docs/82379/1520757
 * Base URL: https://ark.cn-beijing.volces.com/api/v3
 */

const BASE_URL = process.env.SEEDANCE_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3'
const API_KEY = process.env.SEEDANCE_API_KEY
const MODEL = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128'

export interface SeedanceTaskInput {
  prompt: string
  images: string[]         // Public URLs or base64
  duration?: number        // 4-15 or -1 (smart)
  ratio?: string           // adaptive/16:9/9:16/1:1/3:4/4:3/21:9
  resolution?: string      // 720p (default), 480p
  generateAudio?: boolean  // default true
  videoUrl?: string        // Reference video URL (role: reference_video)
}

export interface SeedanceTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

/**
 * Convert <<<image_N>>> references to [图N] format for SeeDance prompt.
 * SeeDance uses "图片N" to reference images in the content array by their order
 * among image_url entries (1-indexed).
 */
function convertImageRefs(prompt: string): string {
  return prompt.replace(/<<<image_(\d+)>>>/g, (_, n) => `[图${n}]`)
}

/**
 * Build SeeDance content array from prompt + images.
 * Decides image role based on count:
 *  - 1 image → first_frame (image-to-video)
 *  - 2 images → first_frame + last_frame
 *  - 3+ images → all reference_image (multimodal reference)
 */
function buildContent(prompt: string, images: string[]): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [
    { type: 'text', text: convertImageRefs(prompt) },
  ]

  for (let i = 0; i < images.length; i++) {
    const url = images[i]
    let role: string
    if (images.length === 1) {
      role = 'first_frame'
    } else if (images.length === 2) {
      role = i === 0 ? 'first_frame' : 'last_frame'
    } else {
      role = 'reference_image'
    }

    content.push({
      type: 'image_url',
      image_url: { url },
      role,
    })
  }

  return content
}

/** Create a SeeDance video generation task. Returns taskId. */
export async function createSeedanceTask(input: SeedanceTaskInput): Promise<string> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY not configured')
  }

  const { prompt, images, duration, ratio, resolution, generateAudio, videoUrl } = input

  const content = buildContent(prompt, images)
  if (videoUrl) {
    content.push({ type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' })
  }

  const payload: Record<string, unknown> = {
    model: MODEL,
    content,
    generate_audio: generateAudio ?? true,
  }

  if (duration != null) payload.duration = duration
  if (ratio) payload.ratio = ratio
  if (resolution) payload.resolution = resolution

  console.log(`[seedance] Creating task: ${images.length} images${videoUrl ? ' + ref video' : ''}, duration=${duration ?? 'smart'}, ratio=${ratio ?? 'adaptive'}`)

  const response = await fetch(`${BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let parsed: { error?: { code?: string; message?: string } } | undefined
    try { parsed = JSON.parse(errorText) } catch {}
    const code = parsed?.error?.code || ''
    if (code.includes('SensitiveContentDetected') || code.includes('UnsupportedImageFormat')) {
      throw new Error('SeeDance does not support images with real human faces. Please switch to Kling or use non-portrait images.')
    }
    throw new Error(`SeeDance API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const taskId = data.id

  if (!taskId) {
    throw new Error(`SeeDance API did not return task id: ${JSON.stringify(data)}`)
  }

  console.log(`[seedance] Task created: ${taskId}`)
  return taskId
}

/** Query a SeeDance task for status + result. */
export async function getSeedanceTask(taskId: string): Promise<SeedanceTaskResult> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY not configured')
  }

  const response = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`SeeDance status query error ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  let status: SeedanceTaskResult['status'] = 'pending'
  switch (data.status) {
    case 'queued': status = 'pending'; break
    case 'running': status = 'processing'; break
    case 'succeeded': status = 'completed'; break
    case 'failed':
    case 'expired':
      status = 'failed'; break
  }

  const videoUrl = data.content?.video_url || undefined
  const error = data.error?.message || undefined

  return { taskId, status, videoUrl, error }
}
