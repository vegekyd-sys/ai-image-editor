/** fal H3 Max Extend: adds 5–15 seconds to one existing video. */
export const H3_MAX_EXTEND_ENDPOINT = 'minimax/h3-max/extend-video'

export interface H3MaxExtendInput {
  videoUrl: string
  prompt: string
  duration: number
  resolution: '480p' | '768p'
  /** Leaving the ratio unset preserves the source canvas. */
  aspectRatio?: string
  onBeforeSubmit?: () => Promise<void>
}

export function buildH3MaxExtendPayload(input: H3MaxExtendInput): Record<string, unknown> {
  if (!/^https:\/\//i.test(input.videoUrl)) throw new Error('H3 Max Extend requires an HTTPS source video URL.')
  const prompt = input.prompt.trim().replace(/<<<(?:image|media|video)_\d+>>>/gi, 'the source video')
  if (!prompt || prompt.length > 50_000) throw new Error('H3 Max Extend requires a continuation prompt of at most 50000 characters.')
  if (!Number.isInteger(input.duration) || input.duration < 5 || input.duration > 15) throw new Error('H3 Max Extend adds 5–15 whole seconds per request.')
  if (!['480p', '768p'].includes(input.resolution)) throw new Error('H3 Max Extend is currently enabled at 480p or 768p.')
  const aspectRatio = !input.aspectRatio || input.aspectRatio === 'auto' ? 'auto' : input.aspectRatio
  if (!['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(aspectRatio)) throw new Error('Unsupported H3 Max Extend aspect ratio.')
  return {
    video_url: input.videoUrl,
    prompt,
    duration: input.duration,
    resolution: input.resolution.toUpperCase(),
    aspect_ratio: aspectRatio,
    output: 'extended',
    enable_prompt_expansion: true,
    enable_safety_checker: true,
  }
}

export async function createFalH3MaxExtendVideoTask(input: H3MaxExtendInput): Promise<string> {
  const payload = buildH3MaxExtendPayload(input)
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('FAL_KEY not configured')
  await input.onBeforeSubmit?.()
  const response = await fetch(`https://queue.fal.run/${H3_MAX_EXTEND_ENDPOINT}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  // Upstream errors can echo signed URLs. Do not include the body in user errors.
  if (!response.ok) throw new Error(`H3 Max Extend submission HTTP ${response.status}; no automatic resubmission.`)
  const body = await response.json().catch(() => ({})) as { request_id?: unknown }
  if (typeof body.request_id !== 'string' || !body.request_id) throw new Error('H3 Max Extend submission outcome unknown; no automatic resubmission.')
  return `fal-h3max-extend-${body.request_id}`
}
