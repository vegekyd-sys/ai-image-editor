import { execFile } from 'child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { findFfmpeg } from './ffmpeg-runtime'

const execFileAsync = promisify(execFile)

const DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
const DEFAULT_RESOURCE_ID = 'volc.bigasr.auc_turbo'
const MAX_DOWNLOAD_BYTES = 220 * 1024 * 1024
const MAX_AUDIO_BASE64_BYTES = 100 * 1024 * 1024
const DEFAULT_FETCH_TIMEOUT_MS = 120_000

export interface TranscriptWord {
  text: string
  startMs: number | null
  endMs: number | null
  confidence?: number | null
}

export interface TranscriptUtterance {
  text: string
  startMs: number | null
  endMs: number | null
  speaker?: string
  words: TranscriptWord[]
}

export interface VolcengineAsrTranscript {
  provider: 'volcengine'
  model: 'bigmodel-flash'
  resourceId: string
  requestId: string
  providerLogId?: string
  requestedLanguage?: string
  text: string
  durationMs: number | null
  utterances: TranscriptUtterance[]
  sourceUrl?: string
  extractedAudio?: boolean
  createdAt: string
}

interface VolcengineAsrOptions {
  mediaUrl: string
  localMediaPath?: string
  uid?: string
  language?: string
  requestId?: string
}

type JsonRecord = Record<string, unknown>

export function isAsrTranscriptCacheCompatible(
  transcript: VolcengineAsrTranscript,
  requestedLanguage?: string,
): boolean {
  return !requestedLanguage || transcript.requestedLanguage === requestedLanguage
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function fetchTimeoutMs(): number {
  const value = Number(env('VOLCENGINE_ASR_TIMEOUT_MS'))
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_FETCH_TIMEOUT_MS
}

async function fetchWithTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs())
  try {
    return await fetch(input, { ...init, signal: init?.signal || controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Volcengine ASR request timed out after ${fetchTimeoutMs()}ms.`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function getCredentials(): { mode: 'api-key'; apiKey: string } | { mode: 'legacy'; appKey: string; accessKey: string } {
  const apiKey = env('VOLCENGINE_ASR_API_KEY')
  if (apiKey) return { mode: 'api-key', apiKey }

  const appKey = env('VOLCENGINE_ASR_APP_KEY')
  const accessKey = env('VOLCENGINE_ASR_ACCESS_KEY')
  if (appKey && accessKey) return { mode: 'legacy', appKey, accessKey }

  throw new Error('Missing Volcengine ASR credentials. Set VOLCENGINE_ASR_API_KEY, or VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY.')
}

function isAudioUrl(mediaUrl: string): boolean {
  const clean = mediaUrl.split('?')[0]?.toLowerCase() || ''
  return /\.(mp3|wav|ogg|opus)$/i.test(clean)
}

function extensionFromContentType(contentType: string | null, mediaUrl: string): string {
  if (contentType?.includes('quicktime')) return '.mov'
  if (contentType?.includes('webm')) return '.webm'
  if (contentType?.includes('mpeg') || contentType?.includes('mp3')) return '.mp3'
  if (contentType?.includes('wav')) return '.wav'
  if (contentType?.includes('ogg')) return '.ogg'
  const ext = path.extname(mediaUrl.split('?')[0] || '')
  return ext || '.mp4'
}

async function downloadMedia(mediaUrl: string, dir: string): Promise<string> {
  const res = await fetchWithTimeout(mediaUrl)
  if (!res.ok) throw new Error(`Failed to download media for ASR: ${res.status}`)

  const length = Number(res.headers.get('content-length') || 0)
  if (length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Media is too large for ASR preprocessing (${Math.round(length / 1024 / 1024)}MB).`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Media is too large for ASR preprocessing (${Math.round(buffer.length / 1024 / 1024)}MB).`)
  }

  const inputPath = path.join(dir, `input${extensionFromContentType(res.headers.get('content-type'), mediaUrl)}`)
  await writeFile(inputPath, buffer)
  return inputPath
}

async function extractAudioBase64(mediaUrl: string, localMediaPath?: string): Promise<{ data: string; extractedAudio: boolean }> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-asr-'))
  try {
    await mkdir(workDir, { recursive: true })
    let inputPath: string
    if (localMediaPath) {
      const localStat = await stat(localMediaPath)
      if (!localStat.isFile()) throw new Error('Local ASR media path is not a file.')
      if (localStat.size > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Local media is too large for ASR preprocessing (${Math.round(localStat.size / 1024 / 1024)}MB).`)
      }
      inputPath = localMediaPath
    } else {
      inputPath = await downloadMedia(mediaUrl, workDir)
    }
    const outputPath = path.join(workDir, 'audio.mp3')
    const ffmpegPath = await findFfmpeg()

    await execFileAsync(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-f', 'mp3',
      outputPath,
    ], { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 })

    const audio = await readFile(outputPath)
    if (audio.length > MAX_AUDIO_BASE64_BYTES) {
      throw new Error(`Extracted audio is too large for Volcengine ASR (${Math.round(audio.length / 1024 / 1024)}MB).`)
    }
    return { data: audio.toString('base64'), extractedAudio: true }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeWords(words: unknown): TranscriptWord[] {
  if (!Array.isArray(words)) return []
  return words
    .filter((word): word is JsonRecord => !!word && typeof word === 'object')
    .map(word => ({
      text: typeof word.text === 'string' ? word.text : '',
      startMs: numberOrNull(word.start_time),
      endMs: numberOrNull(word.end_time),
      confidence: numberOrNull(word.confidence),
    }))
    .filter(word => word.text.length > 0)
}

function normalizeUtterances(utterances: unknown): TranscriptUtterance[] {
  if (!Array.isArray(utterances)) return []
  return utterances
    .filter((utterance): utterance is JsonRecord => !!utterance && typeof utterance === 'object')
    .map(utterance => {
      const additions = utterance.additions && typeof utterance.additions === 'object'
        ? utterance.additions as JsonRecord
        : undefined
      return {
        text: typeof utterance.text === 'string' ? utterance.text : '',
        startMs: numberOrNull(utterance.start_time),
        endMs: numberOrNull(utterance.end_time),
        speaker: typeof additions?.speaker === 'string' ? additions.speaker : undefined,
        words: normalizeWords(utterance.words),
      }
    })
    .filter(utterance => utterance.text.length > 0)
}

function parseDurationMs(body: JsonRecord): number | null {
  const audioInfo = body.audio_info && typeof body.audio_info === 'object' ? body.audio_info as JsonRecord : undefined
  const result = body.result && typeof body.result === 'object' ? body.result as JsonRecord : undefined
  const additions = result?.additions && typeof result.additions === 'object' ? result.additions as JsonRecord : undefined
  return numberOrNull(audioInfo?.duration ?? additions?.duration)
}

function buildHeaders(requestId: string): HeadersInit {
  const credentials = getCredentials()
  const resourceId = env('VOLCENGINE_ASR_RESOURCE_ID') || DEFAULT_RESOURCE_ID
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  }

  if (credentials.mode === 'api-key') {
    headers['X-Api-Key'] = credentials.apiKey
  } else {
    headers['X-Api-App-Key'] = credentials.appKey
    headers['X-Api-Access-Key'] = credentials.accessKey
  }

  return headers
}

export async function transcribeWithVolcengineAsr(options: VolcengineAsrOptions): Promise<VolcengineAsrTranscript> {
  const requestId = options.requestId || crypto.randomUUID()
  const endpoint = env('VOLCENGINE_ASR_ENDPOINT') || DEFAULT_ENDPOINT
  const resourceId = env('VOLCENGINE_ASR_RESOURCE_ID') || DEFAULT_RESOURCE_ID

  let audio: { url: string; language?: string } | { data: string; language?: string }
  let extractedAudio = false
  if (isAudioUrl(options.mediaUrl) && !options.localMediaPath) {
    audio = { url: options.mediaUrl }
  } else {
    const extracted = await extractAudioBase64(options.mediaUrl, options.localMediaPath)
    audio = { data: extracted.data }
    extractedAudio = extracted.extractedAudio
  }

  if (options.language) audio.language = options.language

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: buildHeaders(requestId),
    body: JSON.stringify({
      user: { uid: options.uid || 'makaron-agent' },
      audio,
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
      },
    }),
  })

  const bodyText = await res.text()
  let body: JsonRecord
  try {
    body = JSON.parse(bodyText) as JsonRecord
  } catch {
    body = { raw: bodyText }
  }

  const statusCode = res.headers.get('x-api-status-code')
  const statusMessage = res.headers.get('x-api-message')
  const providerLogId = res.headers.get('x-tt-logid') || undefined
  if (!res.ok || (statusCode && statusCode !== '20000000')) {
    const msg = statusMessage || (typeof body.message === 'string' ? body.message : bodyText.slice(0, 300))
    throw new Error(
      `Volcengine ASR failed (${res.status}${statusCode ? `/${statusCode}` : ''}): ${msg}`
      + `${providerLogId ? ` (logid: ${providerLogId})` : ''}`,
    )
  }

  const result = body.result && typeof body.result === 'object' ? body.result as JsonRecord : undefined
  const text = typeof result?.text === 'string' ? result.text : ''
  const utterances = normalizeUtterances(result?.utterances)

  return {
    provider: 'volcengine',
    model: 'bigmodel-flash',
    resourceId,
    requestId,
    providerLogId,
    requestedLanguage: options.language,
    text,
    durationMs: parseDurationMs(body),
    utterances,
    sourceUrl: options.mediaUrl,
    extractedAudio,
    createdAt: new Date().toISOString(),
  }
}
