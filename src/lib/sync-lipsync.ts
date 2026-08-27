const SUBMIT_URL = 'https://queue.fal.run/fal-ai/sync-lipsync/v3'
const TASK_PREFIX = 'sync3-'

export interface SyncLipsyncTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}
function apiKey(): string {
  const value = process.env.FAL_KEY?.trim()
  if (!value) throw new Error('FAL_KEY not configured')
  return value
}

function rawRequestId(taskId: string): string {
  return taskId.startsWith(TASK_PREFIX) ? taskId.slice(TASK_PREFIX.length) : taskId
}

function queueUrl(requestId: string, suffix = ''): string {
  return `https://queue.fal.run/fal-ai/sync-lipsync/requests/${requestId}${suffix}`
}

export async function createSyncLipsyncTask(input: {
  videoUrl: string
  audioUrl: string
}): Promise<string> {
  const response = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_url: input.videoUrl,
      audio_url: input.audioUrl,
      // Translation frequently changes speech length slightly. remap keeps the
      // supplied Seed Audio intact and makes the source performance follow it.
      sync_mode: 'remap',
    }),
  })

  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body)
    throw new Error(`Sync Lipsync API error ${response.status}: ${detail}`)
  }

  const requestId = typeof body.request_id === 'string' ? body.request_id : ''
  if (!requestId) throw new Error(`Sync Lipsync did not return request_id: ${JSON.stringify(body)}`)
  return `${TASK_PREFIX}${requestId}`
}

export async function getSyncLipsyncTask(taskId: string): Promise<SyncLipsyncTaskResult> {
  const requestId = rawRequestId(taskId)
  const headers = { Authorization: `Key ${apiKey()}` }
  const statusResponse = await fetch(queueUrl(requestId, '/status'), { headers })
  const statusBody = await statusResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!statusResponse.ok) {
    throw new Error(`Sync Lipsync status error ${statusResponse.status}: ${JSON.stringify(statusBody)}`)
  }

  const providerStatus = typeof statusBody.status === 'string' ? statusBody.status : ''
  if (providerStatus === 'IN_QUEUE') return { taskId, status: 'pending' }
  if (providerStatus === 'IN_PROGRESS') return { taskId, status: 'processing' }
  if (providerStatus === 'FAILED') {
    const error = typeof statusBody.error === 'string'
      ? statusBody.error
      : typeof statusBody.detail === 'string'
        ? statusBody.detail
        : 'Sync Lipsync failed.'
    return { taskId, status: 'failed', error }
  }
  if (providerStatus !== 'COMPLETED') return { taskId, status: 'processing' }

  const resultResponse = await fetch(queueUrl(requestId), { headers })
  const resultBody = await resultResponse.json().catch(() => ({})) as {
    video?: { url?: unknown }
    detail?: unknown
  }
  if (!resultResponse.ok) {
    throw new Error(`Sync Lipsync result error ${resultResponse.status}: ${JSON.stringify(resultBody)}`)
  }
  const videoUrl = typeof resultBody.video?.url === 'string' ? resultBody.video.url : undefined
  if (!videoUrl) {
    return { taskId, status: 'failed', error: 'Sync Lipsync completed without a video URL.' }
  }
  return { taskId, status: 'completed', videoUrl }
}
