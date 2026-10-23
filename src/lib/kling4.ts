/** EvoLink Kling 4.0, checked 2026-10-22. Flash has no verified public API.
 * https://evolink.ai/api-reference/kling-4/kling-v4-reference-to-video.md
 * https://evolink.ai/api-reference/kling-4/kling-v4-video-edit.md
 * Images are feature references; keyframe/I2V is not exposed by this adapter.
 */
import { EvolinkSubmissionError } from './evolink'
import { resolveVideoProviderModel } from './video-model-capabilities'

export interface Kling4Input {
  prompt: string
  images: string[]
  videos?: string[]
  duration?: number
  resolution?: '720p' | '1080p'
  aspectRatio?: string
  operation?: 'generate' | 'edit'
}

export function buildKling4Payload(input: Kling4Input): Record<string, unknown> {
  const videos = input.videos ?? []
  const edit = input.operation === 'edit'
  const duration = input.duration ?? (edit ? 'auto' : 5)
  if (!input.prompt.trim() || input.prompt.length > 2500) throw new Error('Kling 4.0 prompt must contain 1–2500 characters.')
  if (duration !== 'auto' && (!Number.isInteger(duration) || duration < 3 || duration > 30)) throw new Error('Kling 4.0 duration must be an integer from 3 to 30 seconds.')
  if (input.images.length > 10 || videos.length > 5 || (edit && videos.length !== 1)) throw new Error('Kling 4.0 accepts 10 images and 5 reference videos; editing requires exactly one video.')
  if ([...input.images, ...videos].some(url => !/^https?:\/\//.test(url))) throw new Error('Kling 4.0 requires accessible HTTP(S) media URLs.')
  const quality = input.resolution ?? '720p'
  if (!['720p', '1080p'].includes(quality)) throw new Error('Kling 4.0 supports 720p and 1080p.')
  const aspect = input.aspectRatio && input.aspectRatio !== 'auto' ? input.aspectRatio : '16:9'
  if (!edit && !['16:9', '9:16', '1:1', '21:9'].includes(aspect)) throw new Error('Unsupported Kling 4.0 aspect ratio.')
  const model = resolveVideoProviderModel({
    model: 'kling-4', resolution: quality, operation: input.operation,
    imageReferenceCount: input.images.length, hasVideoReference: videos.length > 0,
  })
  const prompt = input.prompt.trim().replace(/<<<media_(\d+)>>>/gi, '<<<image_$1>>>')
  for (const match of prompt.matchAll(/<<<(image|video)_(\d+)>>>/gi)) {
    const count = match[1].toLowerCase() === 'image' ? input.images.length : videos.length
    if (Number(match[2]) < 1 || Number(match[2]) > count) throw new Error('Kling 4.0 prompt references a missing input.')
  }
  return { model, prompt, duration, quality,
    ...(!edit ? { aspect_ratio: aspect } : {}),
    ...(input.images.length ? { image_urls: input.images } : {}),
    ...(videos.length ? { video_urls: videos } : {}),
  }
}

export async function createKling4Task(input: Kling4Input): Promise<string> {
  const payload = buildKling4Payload(input)
  const key = process.env.EVOLINK_API_KEY?.trim()
  if (!key) throw new Error('EVOLINK_API_KEY not configured')
  // One POST only. A lost receipt is not permission to create a second paid task.
  const response = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if ([400, 401, 402, 403, 404, 413, 415, 422, 429].includes(response.status)) throw new EvolinkSubmissionError(response.status)
  if (!response.ok) throw new Error(`Kling 4.0 submission HTTP ${response.status}; outcome unknown. Do not resubmit.`)
  const data = await response.json()
  if (typeof data.id !== 'string' || !data.id.startsWith('task-unified-')) throw new Error('Kling 4.0 submission receipt missing; outcome unknown. Do not resubmit.')
  return data.id
}
