/**
 * sunoapi.org adapter for instrumental background music (Suno V6).
 *
 * Only the audio router (`resolveAudioRoute`) decides when this provider is
 * used: pure instrumental BGM with no audio/image conditioning. Every other
 * audio request stays on Seed Audio.
 *
 * One Suno generation is billed once and returns several takes (currently 2).
 */

const SUNO_BASE = 'https://api.sunoapi.org/api/v1'
const DEFAULT_MODEL = 'V6'
const DEFAULT_FETCH_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_TIMEOUT_MS = 240_000
export const SUNO_MIN_DURATION_SECONDS = 10
export const SUNO_MAX_DURATION_SECONDS = 360
export const SUNO_MAX_STYLE_CHARS = 1000
const SUNO_MAX_TITLE_CHARS = 80

export type SunoModel = 'V6' | 'V6_MINI' | 'V6_WILD'

export interface SunoMusicInput {
  /** Genre, mood, instruments, tempo, energy arc and ending (Suno "style"). */
  style: string
  title?: string
  durationSeconds?: number
  negativeTags?: string
  model?: SunoModel
  signal?: AbortSignal
}

export interface SunoTake {
  audioUrl: string
  streamAudioUrl?: string
  duration: number
  title: string
  tags: string
  providerTrackId?: string
}

export type SunoTaskStatus = 'pending' | 'processing' | 'streaming' | 'completed' | 'failed'

export interface SunoTaskResult {
  taskId: string
  status: SunoTaskStatus
  takes: SunoTake[]
  error?: string
}

export interface SunoMusicResult {
  taskId: string
  provider: 'sunoapi'
  model: SunoModel
  takes: SunoTake[]
  generationSeconds: number
}

export function isSunoConfigured(): boolean {
  return !!process.env.SUNOAPI_KEY?.trim()
}

function headers(): Record<string, string> {
  const key = process.env.SUNOAPI_KEY?.trim()
  if (!key) throw new Error('SUNOAPI_KEY is not configured.')
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

function pollIntervalMs(): number {
  const value = Number(process.env.SUNOAPI_POLL_INTERVAL_MS)
  return Number.isFinite(value) && value > 0 ? value : 3000
}

function waitTimeoutMs(): number {
  const value = Number(process.env.SUNOAPI_WAIT_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WAIT_TIMEOUT_MS
}

async function sunoFetch(path: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  init?.signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${SUNO_BASE}${path}`, { ...init, headers: headers(), signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`SunoAPI ${path} failed (${res.status}): ${text.slice(0, 300)}`)
    const json = JSON.parse(text)
    if (json.code !== 200) throw new Error(`SunoAPI error (${json.code}): ${json.msg || 'unknown error'}`)
    return json.data
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(init?.signal?.aborted ? 'Suno request was cancelled.' : `SunoAPI ${path} timed out.`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', onAbort)
  }
}

export function buildSunoGenerateBody(input: SunoMusicInput): Record<string, unknown> {
  const style = input.style.trim()
  if (!style) throw new Error('Suno style prompt is required.')
  if (style.length > SUNO_MAX_STYLE_CHARS) {
    throw new Error(`Suno music prompt must be ${SUNO_MAX_STYLE_CHARS} characters or less.`)
  }
  const body: Record<string, unknown> = {
    customMode: true,
    instrumental: true,
    model: input.model || DEFAULT_MODEL,
    style,
    title: (input.title?.trim() || 'Background music').slice(0, SUNO_MAX_TITLE_CHARS),
    prompt: '',
    callBackUrl: 'https://makaron.app/api/noop',
  }
  if (input.durationSeconds != null) {
    const duration = Math.round(input.durationSeconds)
    if (duration < SUNO_MIN_DURATION_SECONDS || duration > SUNO_MAX_DURATION_SECONDS) {
      throw new Error(`Suno music duration must be between ${SUNO_MIN_DURATION_SECONDS} and ${SUNO_MAX_DURATION_SECONDS} seconds.`)
    }
    body.duration = duration
  }
  if (input.negativeTags?.trim()) body.negativeTags = input.negativeTags.trim().slice(0, 200)
  return body
}

/** Submit an instrumental music generation. Returns the Suno task ID. */
export async function createSunoTask(input: SunoMusicInput): Promise<string> {
  const body = buildSunoGenerateBody(input)
  const data = await sunoFetch('/generate', { method: 'POST', body: JSON.stringify(body), signal: input.signal })
  const taskId = data?.taskId
  if (!taskId) throw new Error('SunoAPI returned no taskId.')
  return String(taskId)
}

function toTake(record: Record<string, unknown>): SunoTake | null {
  const audioUrl = typeof record.audioUrl === 'string' ? record.audioUrl : typeof record.audio_url === 'string' ? record.audio_url : ''
  const streamAudioUrl = typeof record.streamAudioUrl === 'string' ? record.streamAudioUrl : typeof record.stream_audio_url === 'string' ? record.stream_audio_url : ''
  if (!audioUrl && !streamAudioUrl) return null
  const duration = Number(record.duration)
  return {
    audioUrl,
    streamAudioUrl: streamAudioUrl || undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    title: typeof record.title === 'string' ? record.title : '',
    tags: typeof record.tags === 'string' ? record.tags : '',
    providerTrackId: typeof record.id === 'string' ? record.id : undefined,
  }
}

export function mapSunoRecord(taskId: string, data: Record<string, any> | null | undefined): SunoTaskResult {
  const sunoStatus = String(data?.status || 'PENDING')
  const records: Record<string, unknown>[] = Array.isArray(data?.response?.sunoData) ? data.response.sunoData : []
  const takes = records.map(toTake).filter((take): take is SunoTake => !!take)
  switch (sunoStatus) {
    case 'SUCCESS':
      return { taskId, status: 'completed', takes: takes.filter(take => take.audioUrl) }
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return { taskId, status: 'failed', takes: [], error: String(data?.errorMessage || sunoStatus) }
    case 'TEXT_SUCCESS':
    case 'FIRST_SUCCESS':
      // FIRST_SUCCESS means one take is final; keep waiting until every take is final.
      return { taskId, status: takes.some(take => take.streamAudioUrl) ? 'streaming' : 'processing', takes }
    default:
      return { taskId, status: sunoStatus === 'PENDING' ? 'pending' : 'processing', takes }
  }
}

/** Read the current provider state of a Suno task. */
export async function getSunoTask(taskId: string, signal?: AbortSignal): Promise<SunoTaskResult> {
  const data = await sunoFetch(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`, { signal })
  return mapSunoRecord(taskId, data)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Suno request was cancelled.'))
    }, { once: true })
  })
}

/** Generate instrumental BGM and wait until every take has a final audio URL. */
export async function generateSunoMusic(input: SunoMusicInput): Promise<SunoMusicResult> {
  const startedAt = Date.now()
  const model = input.model || DEFAULT_MODEL
  const taskId = await createSunoTask({ ...input, model })
  const deadline = startedAt + waitTimeoutMs()
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs(), input.signal)
    const result = await getSunoTask(taskId, input.signal)
    if (result.status === 'failed') throw new Error(`Suno generation failed: ${result.error || 'unknown error'}`)
    if (result.status === 'completed') {
      if (!result.takes.length) throw new Error('Suno generation completed without audio.')
      return {
        taskId,
        provider: 'sunoapi',
        model,
        takes: result.takes,
        generationSeconds: (Date.now() - startedAt) / 1000,
      }
    }
  }
  throw new Error(`Suno generation timed out after ${Math.round(waitTimeoutMs() / 1000)}s (task ${taskId}).`)
}
