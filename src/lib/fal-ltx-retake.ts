export const LTX_RETAKE_ENDPOINT = 'fal-ai/ltx-2.3/retake-video'
const QUEUE = 'https://queue.fal.run/fal-ai/ltx-2.3'
function headers() {
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('LTX Retake is not configured.')
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
}
export class LtxSubmissionError extends Error {
  constructor(public readonly uncertain: boolean) { super(uncertain ? 'LTX submission outcome unknown. Poll the existing task; do not resubmit.' : 'LTX rejected the Retake request.') }
}
export async function submitLtxRetake(videoUrl: string, prompt: string, start: number, duration: number): Promise<string> {
  let response: Response
  try {
    response = await fetch(`https://queue.fal.run/${LTX_RETAKE_ENDPOINT}`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ video_url: videoUrl, prompt, start_time: start, duration, retake_mode: 'replace_video' }),
      signal: AbortSignal.timeout(30_000), redirect: 'error' })
  } catch { throw new LtxSubmissionError(true) }
  if (!response.ok) throw new LtxSubmissionError(![400, 401, 403, 422].includes(response.status))
  const body = await response.json().catch(() => ({}))
  if (typeof body.request_id !== 'string') throw new LtxSubmissionError(true)
  return body.request_id
}
export async function pollLtxRetake(requestId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; videoUrl?: string; error?: string }> {
  if (!/^[a-zA-Z0-9-]+$/.test(requestId)) throw new Error('Invalid LTX receipt.')
  const url = `${QUEUE}/requests/${requestId}`
  const response = await fetch(`${url}/status`, { headers: headers(), signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error('LTX status unavailable. Keep polling this task.')
  const status = await response.json()
  if (status.status === 'FAILED' || status.error) return { status: 'failed', error: 'LTX Retake rendering failed.' }
  if (status.status !== 'COMPLETED') return { status: 'processing' }
  const result = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!result.ok) throw new Error('LTX result unavailable. Keep polling this task.')
  const body = await result.json()
  if (typeof body.video?.url !== 'string') return { status: 'failed', error: 'LTX returned no video.' }
  return { status: 'completed', videoUrl: body.video.url }
}
