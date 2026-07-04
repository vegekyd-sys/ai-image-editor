import { getAudioModelCapability } from './audio-model-capabilities'

const BASE_URL = 'https://api.evolink.ai'
const DEFAULT_MODEL = 'doubao-seed-audio-1-0'

export interface EvolinkSeedAudioInput {
  prompt: string
  durationSeconds?: number
  format?: 'mp3' | 'wav'
  sampleRate?: number
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

function withDurationHint(prompt: string, durationSeconds?: number): string {
  if (!durationSeconds) return prompt
  if (/约?\s*\d+(\.\d+)?\s*秒/.test(prompt) || /\b\d+(\.\d+)?\s*(s|sec|second|seconds)\b/i.test(prompt)) {
    return prompt
  }
  return `Generate about ${Math.round(durationSeconds)} seconds of audio.\n${prompt}`
}

export async function generateWithEvolinkSeedAudio(input: EvolinkSeedAudioInput): Promise<EvolinkSeedAudioResult> {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Audio prompt is required.')

  const capability = getAudioModelCapability('evolink-seed-audio')
  if (input.durationSeconds && input.durationSeconds > capability.maxDurationSeconds) {
    throw new Error(`${capability.label} duration must be ${capability.maxDurationSeconds} seconds or less.`)
  }

  const startedAt = Date.now()
  const submitRes = await fetch(`${BASE_URL}/v1/audios/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      prompt: withDurationHint(prompt, input.durationSeconds),
      format: input.format || capability.defaultFormat,
      sample_rate: input.sampleRate || 24000,
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
    const statusRes = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
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
