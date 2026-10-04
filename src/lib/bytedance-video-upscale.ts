/** BytePlus VOD Fast through fal. Submission is deliberately never retried. */
export const BYTEDANCE_UPSCALE_ENDPOINT = 'fal-ai/bytedance-upscaler/upscale/video'
const QUEUE = 'https://queue.fal.run/fal-ai/bytedance-upscaler'
export const UPSCALE_RESOLUTIONS = ['720p', '1080p', '2k', '4k'] as const
export type UpscaleResolution = typeof UPSCALE_RESOLUTIONS[number]
export const UPSCALE_PUBLIC_RATES = { '720p': .0072, '1080p': .0072, '2k': .0144, '4k': .0288 } as const
export type UpscalePreset = 'general' | 'ugc' | 'short_series' | 'aigc' | 'old_film'

export class UpscaleSubmissionError extends Error {
  constructor(public readonly uncertain: boolean) {
    super(uncertain ? 'Upscale submission outcome unknown. Retain the task; do not submit again.' : 'Upscale input rejected. Correct the source before submitting again.')
  }
}
function auth() {
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('Video upscaler is not configured.')
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
}
export function buildUpscaleInput(input: { videoUrl: string; resolution: UpscaleResolution; fps: number; preset?: UpscalePreset }) {
  if (!UPSCALE_RESOLUTIONS.includes(input.resolution)) throw new Error('Video upscaling currently supports 720p, 1080p, 2K and 4K; 6K/8K pricing is not configured.')
  if (!Number.isFinite(input.fps) || input.fps < 1 || input.fps > 60) throw new Error('A measured source frame rate between 1 and 60 fps is required.')
  if (!['https:', 'http:'].includes(new URL(input.videoUrl).protocol)) throw new Error('A hosted source video is required.')
  return { video_url: input.videoUrl, target_resolution: input.resolution === '720p' ? '1080p' : input.resolution, target_fps: input.fps,
    enhancement_preset: input.preset ?? 'general', enhancement_tier: 'fast', fidelity: 'high', bit_depth: 8 }
}
export async function submitByteDanceUpscale(input: Parameters<typeof buildUpscaleInput>[0]): Promise<string> {
  const headers = auth(), payload = buildUpscaleInput(input)
  let response: Response
  try { response = await fetch(`https://queue.fal.run/${BYTEDANCE_UPSCALE_ENDPOINT}`, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) }) }
  catch { throw new UpscaleSubmissionError(true) }
  if (!response.ok) throw new UpscaleSubmissionError(![400, 401, 403, 422, 429].includes(response.status))
  const data = await response.json().catch(() => ({}))
  if (typeof data.request_id !== 'string') throw new UpscaleSubmissionError(true)
  return data.request_id
}
export async function pollByteDanceUpscale(requestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; videoUrl?: string; duration?: number; error?: string }> {
  const headers = auth(), url = `${QUEUE}/requests/${encodeURIComponent(requestId)}`
  const response = await fetch(`${url}/status`, { headers, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('Unable to query video upscaler; retain the existing task.')
  const state = await response.json()
  if (state.status === 'IN_QUEUE') return { status: 'pending' }
  if (state.status === 'FAILED') return { status: 'failed', error: 'Video upscaling failed.' }
  if (state.status !== 'COMPLETED') return { status: 'processing' }
  const result = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  if ([422, 499].includes(result.status)) return { status: 'failed', error: 'Video upscaling failed or was cancelled.' }
  if (!result.ok) throw new Error('Upscale result is temporarily unavailable; retain the existing task.')
  const data = await result.json()
  if (typeof data.video?.url !== 'string') throw new Error('Upscale result has no video; retain the existing task.')
  return { status: 'completed', videoUrl: data.video.url, duration: data.duration }
}
