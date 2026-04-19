const SUNO_BASE = 'https://api.sunoapi.org/api/v1'

export interface SunoTaskInput {
  prompt: string
  instrumental?: boolean  // default true
  model?: string          // default 'V5_5'
  style?: string          // genre/mood tags (custom mode only)
}

export interface SunoTrack {
  audioUrl: string
  streamAudioUrl?: string
  duration: number
  title: string
  tags: string
}

export interface SunoTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'streaming' | 'completed' | 'failed'
  tracks?: SunoTrack[]   // 2 tracks per generation
  error?: string
}

function headers() {
  const key = process.env.SUNOAPI_KEY?.trim()
  if (!key) throw new Error('SUNOAPI_KEY must be set')
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

/** Submit a music generation task. Returns the Suno task ID. */
export async function createSunoTask(input: SunoTaskInput): Promise<string> {
  const useCustomMode = !!input.style
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    customMode: useCustomMode,
    instrumental: input.instrumental ?? true,
    model: input.model || 'V4_5',
    callBackUrl: 'https://makaron.app/api/noop',
  }
  if (useCustomMode && input.style) {
    body.style = input.style
    body.title = '' // required in custom mode, let Suno auto-generate
  }

  console.log(`\n🎵 [suno] creating task: prompt="${input.prompt.slice(0, 80)}", model=${body.model}, instrumental=${body.instrumental}`)

  const res = await fetch(`${SUNO_BASE}/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SunoAPI generate failed (${res.status}): ${text}`)
  }

  const json = await res.json()
  if (json.code !== 200) {
    throw new Error(`SunoAPI error (${json.code}): ${json.msg}`)
  }

  const taskId = json.data?.taskId
  if (!taskId) throw new Error('SunoAPI: no taskId in response')

  console.log(`🎵 [suno] task created: ${taskId}`)
  return taskId
}

/** Poll a music generation task status. */
export async function getSunoTask(taskId: string): Promise<SunoTaskResult> {
  const res = await fetch(`${SUNO_BASE}/generate/record-info?taskId=${taskId}`, {
    headers: headers(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SunoAPI poll failed (${res.status}): ${text}`)
  }

  const json = await res.json()
  if (json.code !== 200) {
    throw new Error(`SunoAPI error (${json.code}): ${json.msg}`)
  }

  const data = json.data
  const sunoStatus: string = data?.status || 'PENDING'

  // Map Suno status to normalized status
  let status: SunoTaskResult['status']
  let error: string | undefined
  const sunoData: Record<string, unknown>[] = data?.response?.sunoData || []

  switch (sunoStatus) {
    case 'SUCCESS':
    case 'FIRST_SUCCESS':
      status = 'completed'
      break
    case 'TEXT_SUCCESS': {
      const hasStream = sunoData.some((t: Record<string, unknown>) => t.streamAudioUrl)
      status = hasStream ? 'streaming' : 'processing'
      break
    }
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      status = 'failed'
      error = data?.errorMessage || sunoStatus
      break
    default:
      status = 'processing'
  }

  // Extract tracks when streaming (streamAudioUrl available) or completed (audioUrl available)
  let tracks: SunoTrack[] | undefined
  if ((status === 'streaming' || status === 'completed') && sunoData.length) {
    tracks = sunoData
      .filter((t: Record<string, unknown>) => t.streamAudioUrl || t.audioUrl)
      .map((t: Record<string, unknown>) => ({
        audioUrl: (t.audioUrl as string) || '',
        streamAudioUrl: (t.streamAudioUrl as string) || undefined,
        duration: (t.duration as number) || 0,
        title: (t.title as string) || '',
        tags: (t.tags as string) || '',
      }))
  }

  return { taskId, status, tracks, error }
}
