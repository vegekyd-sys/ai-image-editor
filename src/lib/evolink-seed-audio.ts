import { getAudioModelCapability } from './audio-model-capabilities'

const BASE_URL = 'https://api.evolink.ai'
const DEFAULT_MODEL = 'doubao-seed-audio-1-0'
const DEFAULT_FETCH_TIMEOUT_MS = 60_000
const MAX_PROMPT_CHARS = 1500
const MAX_AUDIO_REFERENCES = 3
const ALLOWED_SAMPLE_RATES = new Set([8000, 16000, 24000, 48000])

export type SeedAudioFormat = 'mp3' | 'wav' | 'pcm' | 'ogg_opus'

export interface EvolinkSeedAudioInput {
  prompt: string
  durationSeconds?: number
  audioReferences?: string[]
  imageUrls?: string[]
  speechRate?: number
  loudnessRate?: number
  pitchRate?: number
  format?: SeedAudioFormat
  sampleRate?: number
  callbackUrl?: string
}

export interface EvolinkSeedAudioResult {
  taskId: string
  provider: 'evolink'
  model: string
  status: 'completed'
  audioUrl: string
  duration: number
  format: string
  creditsUsed?: number
  generationSeconds: number
  providerPayload?: unknown
}

function apiKey(): string {
  const key = process.env.EVOLINK_API_KEY?.trim()
  if (!key) throw new Error('EVOLINK_API_KEY is not configured.')
  return key
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function pollIntervalMs(): number {
  const value = Number(process.env.EVOLINK_SEED_AUDIO_POLL_INTERVAL_MS)
  return Number.isFinite(value) && value > 0 ? value : 3000
}

function fetchTimeoutMs(): number {
  const value = Number(process.env.EVOLINK_SEED_AUDIO_FETCH_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_FETCH_TIMEOUT_MS
}

async function fetchWithTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs())
  try {
    return await fetch(input, { ...init, signal: init?.signal || controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`EvoLink Seed Audio request timed out after ${fetchTimeoutMs()}ms.`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function withDurationHint(prompt: string, durationSeconds?: number): string {
  if (!durationSeconds) return prompt
  if (/约?\s*\d+(\.\d+)?\s*秒/.test(prompt) || /\b\d+(\.\d+)?\s*(s|sec|second|seconds)\b/i.test(prompt)) {
    return prompt
  }
  return `Generate about ${Math.round(durationSeconds)} seconds of audio.\n${prompt}`
}

function assertRate(name: string, value: number | undefined, min: number, max: number): void {
  if (value == null) return
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`)
  }
}

function validateInput(input: EvolinkSeedAudioInput, prompt: string): void {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Seed Audio prompt must be ${MAX_PROMPT_CHARS} characters or less after duration guidance.`)
  }

  const audioReferences = input.audioReferences?.filter(Boolean) || []
  const imageUrls = input.imageUrls?.filter(Boolean) || []
  if (audioReferences.length > MAX_AUDIO_REFERENCES) {
    throw new Error(`Seed Audio supports at most ${MAX_AUDIO_REFERENCES} audio references.`)
  }
  if (imageUrls.length > 1) {
    throw new Error('Seed Audio supports at most one reference image.')
  }
  if (audioReferences.length && imageUrls.length) {
    throw new Error('Seed Audio reference audio and reference image are mutually exclusive.')
  }
  audioReferences.forEach((_, index) => {
    if (!new RegExp(`@audio${index + 1}\\b`, 'i').test(prompt)) {
      throw new Error(`Seed Audio prompt must reference audioReferences[${index}] as @audio${index + 1}.`)
    }
  })
  audioReferences.forEach((reference) => {
    if (/^http:\/\//i.test(reference)) {
      throw new Error('Seed Audio reference audio URLs must use HTTPS.')
    }
  })
  imageUrls.forEach((url) => {
    if (!/^https:\/\//i.test(url)) {
      throw new Error('Seed Audio reference image must be a public HTTPS URL.')
    }
  })

  assertRate('speechRate', input.speechRate, 0.5, 2)
  assertRate('loudnessRate', input.loudnessRate, 0.5, 2)
  assertRate('pitchRate', input.pitchRate, -12, 12)
  if (input.pitchRate != null && !Number.isInteger(input.pitchRate)) {
    throw new Error('pitchRate must be an integer number of semitones.')
  }
  if (input.sampleRate != null && !ALLOWED_SAMPLE_RATES.has(input.sampleRate)) {
    throw new Error('sampleRate must be one of 8000, 16000, 24000, or 48000.')
  }
  if (input.callbackUrl && !/^https:\/\//i.test(input.callbackUrl)) {
    throw new Error('callbackUrl must be an HTTPS URL.')
  }
}

export async function generateWithEvolinkSeedAudio(input: EvolinkSeedAudioInput): Promise<EvolinkSeedAudioResult> {
  const rawPrompt = input.prompt.trim()
  if (!rawPrompt) throw new Error('Audio prompt is required.')

  const capability = getAudioModelCapability('evolink-seed-audio')
  if (input.durationSeconds != null && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0)) {
    throw new Error('Seed Audio duration must be a positive number of seconds.')
  }
  if (input.durationSeconds && input.durationSeconds > capability.maxDurationSeconds) {
    throw new Error(`${capability.label} duration must be ${capability.maxDurationSeconds} seconds or less.`)
  }
  const audioReferences = input.audioReferences?.map(reference => reference.trim()).filter(Boolean)
  const imageUrls = input.imageUrls?.map(url => url.trim()).filter(Boolean)
  const normalizedInput = {
    ...input,
    audioReferences,
    imageUrls,
    callbackUrl: input.callbackUrl?.trim(),
  }
  const prompt = withDurationHint(rawPrompt, input.durationSeconds)
  validateInput(normalizedInput, prompt)

  const startedAt = Date.now()
  const submitRes = await fetchWithTimeout(`${BASE_URL}/v1/audios/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      prompt,
      ...(audioReferences?.length ? { audio_references: audioReferences } : {}),
      ...(imageUrls?.length ? { image_urls: imageUrls } : {}),
      ...(input.speechRate != null ? { speech_rate: input.speechRate } : {}),
      ...(input.loudnessRate != null ? { loudness_rate: input.loudnessRate } : {}),
      ...(input.pitchRate != null ? { pitch_rate: input.pitchRate } : {}),
      format: input.format || capability.defaultFormat,
      sample_rate: input.sampleRate || capability.defaultSampleRate,
      ...(normalizedInput.callbackUrl ? { callback_url: normalizedInput.callbackUrl } : {}),
    }),
  })

  const submitText = await submitRes.text()
  if (!submitRes.ok) {
    throw new Error(`EvoLink Seed Audio submit failed (${submitRes.status}): ${submitText}`)
  }

  let submitBody: { id?: string }
  try {
    submitBody = JSON.parse(submitText)
  } catch {
    throw new Error(`EvoLink Seed Audio submit returned invalid JSON: ${submitText.slice(0, 300)}`)
  }

  const taskId = submitBody.id
  if (!taskId) throw new Error(`EvoLink Seed Audio did not return task id: ${submitText.slice(0, 300)}`)

  const intervalMs = pollIntervalMs()
  for (let poll = 0; poll < 80; poll++) {
    await sleep(intervalMs)
    const statusRes = await fetchWithTimeout(`${BASE_URL}/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    })
    const statusText = await statusRes.text()
    if (!statusRes.ok) {
      throw new Error(`EvoLink Seed Audio status failed (${statusRes.status}): ${statusText}`)
    }

    let body: Record<string, any>
    try {
      body = JSON.parse(statusText)
    } catch {
      throw new Error(`EvoLink Seed Audio status returned invalid JSON: ${statusText.slice(0, 300)}`)
    }

    if (body.status === 'failed' || body.status === 'cancelled') {
      const message = body.error?.message || body.error || 'unknown error'
      throw new Error(`EvoLink Seed Audio task ${body.status}: ${message}`)
    }

    if (body.status === 'completed') {
      const first = Array.isArray(body.result_data) ? body.result_data[0] : undefined
      const audioUrl = first?.audio_url || (Array.isArray(body.results) ? body.results[0] : undefined)
      if (!audioUrl) throw new Error('EvoLink Seed Audio completed without audio_url.')
      return {
        taskId,
        provider: 'evolink',
        model: DEFAULT_MODEL,
        status: 'completed',
        audioUrl,
        duration: Number(first?.duration || body.duration || input.durationSeconds || 0),
        format: String(first?.format || input.format || capability.defaultFormat),
        creditsUsed: typeof body.usage?.credits_used === 'number' ? body.usage.credits_used : undefined,
        generationSeconds: (Date.now() - startedAt) / 1000,
        providerPayload: body,
      }
    }
  }

  throw new Error(`EvoLink Seed Audio task timed out after ${taskId}.`)
}
