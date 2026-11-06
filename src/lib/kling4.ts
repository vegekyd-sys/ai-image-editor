/** EvoLink Kling 4.0 (checked 2026-10-22) and Kling 4.0 Flash (checked 2026-11-06).
 * https://evolink.ai/api-reference/kling-4/kling-v4-reference-to-video.md
 * https://evolink.ai/api-reference/kling-4/kling-v4-video-edit.md
 * https://evolink.ai/docs/en/api-manual/video-series/kling/kling-v4-flash-reference-to-video
 * Flash uses separate model IDs with the same fields: 720p only, 3–20s output,
 * <=20s of reference/source video. Images are feature references; keyframe/I2V
 * is not exposed by this adapter.
 */
import { EvolinkSubmissionError } from './evolink'
import { getVideoModelCapability, resolveVideoProviderModel } from './video-model-capabilities'

export type Kling4Model = 'kling-4' | 'kling-4-flash'

export interface Kling4Input {
  /** Defaults to Kling 4.0. Never switched to the other variant on failure. */
  model?: Kling4Model
  prompt: string
  images: string[]
  videos?: string[]
  duration?: number
  resolution?: '720p' | '1080p'
  aspectRatio?: string
  operation?: 'generate' | 'edit'
}

export function buildKling4Payload(input: Kling4Input): Record<string, unknown> {
  const variant: Kling4Model = input.model === 'kling-4-flash' ? 'kling-4-flash' : 'kling-4'
  const { label, maxOutputDuration: maxDuration, supportedResolutions = ['720p'] } = getVideoModelCapability(variant)
  const videos = input.videos ?? []
  const edit = input.operation === 'edit'
  const duration = input.duration ?? (edit ? 'auto' : 5)
  if (!input.prompt.trim() || input.prompt.length > 2500) throw new Error(`${label} prompt must contain 1–2500 characters.`)
  if (duration !== 'auto' && (!Number.isInteger(duration) || duration < 3 || duration > maxDuration)) throw new Error(`${label} duration must be an integer from 3 to ${maxDuration} seconds.`)
  if (input.images.length > 10 || videos.length > 5 || (edit && videos.length !== 1)) throw new Error(`${label} accepts 10 images and 5 reference videos; editing requires exactly one video.`)
  if ([...input.images, ...videos].some(url => !/^https?:\/\//.test(url))) throw new Error(`${label} requires accessible HTTP(S) media URLs.`)
  const quality = input.resolution ?? '720p'
  if (!(supportedResolutions as string[]).includes(quality)) throw new Error(`${label} supports ${supportedResolutions.join(' and ')}.`)
  const aspect = input.aspectRatio && input.aspectRatio !== 'auto' ? input.aspectRatio : '16:9'
  if (!edit && !['16:9', '9:16', '1:1', '21:9'].includes(aspect)) throw new Error(`Unsupported ${label} aspect ratio.`)
  const model = resolveVideoProviderModel({
    model: variant, resolution: quality, operation: input.operation,
    imageReferenceCount: input.images.length, hasVideoReference: videos.length > 0,
  })
  const prompt = input.prompt.trim().replace(/<<<media_(\d+)>>>/gi, '<<<image_$1>>>')
  for (const match of prompt.matchAll(/<<<(image|video)_(\d+)>>>/gi)) {
    const count = match[1].toLowerCase() === 'image' ? input.images.length : videos.length
    if (Number(match[2]) < 1 || Number(match[2]) > count) throw new Error(`${label} prompt references a missing input.`)
  }
  return { model, prompt, duration, quality,
    ...(!edit ? { aspect_ratio: aspect } : {}),
    ...(input.images.length ? { image_urls: input.images } : {}),
    ...(videos.length ? { video_urls: videos } : {}),
  }
}

export async function createKling4Task(input: Kling4Input): Promise<string> {
  const payload = buildKling4Payload(input)
  const label = getVideoModelCapability(input.model ?? 'kling-4').label
  const key = process.env.EVOLINK_API_KEY?.trim()
  if (!key) throw new Error('EVOLINK_API_KEY not configured')
  // One POST only. A lost receipt is not permission to create a second paid task.
  const response = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if ([400, 401, 402, 403, 404, 413, 415, 422, 429].includes(response.status)) throw new EvolinkSubmissionError(response.status)
  if (!response.ok) throw new Error(`${label} submission HTTP ${response.status}; outcome unknown. Do not resubmit.`)
  const data = await response.json()
  if (typeof data.id !== 'string' || !data.id.startsWith('task-unified-')) throw new Error(`${label} submission receipt missing; outcome unknown. Do not resubmit.`)
  return data.id
}
