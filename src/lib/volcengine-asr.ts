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
const ASR_CONFIG_VERSION = 3

// Recording-file flash accepts these recognition locales, not arbitrary voice locales.
const RECOGNITION_LOCALES = [
  'zh-CN', 'en-US', 'ja-JP', 'id-ID', 'es-MX', 'pt-BR', 'de-DE', 'fr-FR',
  'ko-KR', 'fil-PH', 'ms-MY', 'th-TH', 'ar-SA', 'it-IT', 'bn-BD', 'el-GR',
  'nl-NL', 'ru-RU', 'tr-TR', 'vi-VN', 'pl-PL', 'ro-RO', 'ne-NP', 'uk-UA', 'yue-CN',
]

export function normalizeAsrLanguage(language?: string): string | undefined {
  const value = language?.trim().replace(/_/g, '-')
  if (!value || /^(auto|default)$/i.test(value)) return undefined
  const base = value.toLowerCase().split('-')[0]
  const canonical = RECOGNITION_LOCALES.find(locale => locale.toLowerCase().split('-')[0] === base)
  if (!canonical) throw new Error(`Unsupported Volcengine ASR language: ${value}. Use a supported recognition language or omit for multilingual detection.`)
  return canonical
}

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
  asrConfigVersion?: number
  inverseTextNormalization?: boolean
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
  sourceRange?: { startSec: number; endSec: number }
  uid?: string
  language?: string
  requestId?: string
}

type JsonRecord = Record<string, unknown>

export function isAsrTranscriptCacheCompatible(
  transcript: VolcengineAsrTranscript,
  requestedLanguage?: string,
): boolean {
  return transcript.asrConfigVersion === ASR_CONFIG_VERSION
    && transcript.requestedLanguage === normalizeAsrLanguage(requestedLanguage)
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
  // The deadline must remain attached while response bodies are streamed/read.
  // Clearing a timer after headers leaves a stalled media download unbounded.
  try {
    return await fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(fetchTimeoutMs()) })
  } catch (err) {
    if (err instanceof Error && ['AbortError', 'TimeoutError'].includes(err.name)) {
      throw new Error(`Volcengine ASR request timed out after ${fetchTimeoutMs()}ms.`)
    }
    throw err
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
    await res.body?.cancel()
    throw new Error(`Media is too large for ASR preprocessing (${Math.round(length / 1024 / 1024)}MB).`)
  }

  if (!res.body) throw new Error('ASR media download returned no body.')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let downloaded = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      downloaded += value.byteLength
      if (downloaded > MAX_DOWNLOAD_BYTES) {
        await reader.cancel()
        throw new Error(`Media is too large for ASR preprocessing (${Math.round(downloaded / 1024 / 1024)}MB).`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const buffer = Buffer.concat(chunks, downloaded)

  const inputPath = path.join(dir, `input${extensionFromContentType(res.headers.get('content-type'), mediaUrl)}`)
  await writeFile(inputPath, buffer)
  return inputPath
}

async function extractAudioBase64(
  mediaUrl: string,
  localMediaPath?: string,
  sourceRange?: { startSec: number; endSec: number },
): Promise<{ data: string; extractedAudio: boolean }> {
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
    } else if (sourceRange) {
      inputPath = mediaUrl
    } else {
      inputPath = await downloadMedia(mediaUrl, workDir)
    }
    const outputPath = path.join(workDir, 'audio.mp3')
    const ffmpegPath = await findFfmpeg()

    const rangeArgs = sourceRange
      ? ['-ss', String(sourceRange.startSec), '-t', String(sourceRange.endSec - sourceRange.startSec)]
      : []
    await execFileAsync(ffmpegPath, [
      '-y',
      ...rangeArgs,
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
  const language = normalizeAsrLanguage(options.language)
  // Arabic compound numerals can be corrupted by provider ITN: measured
  // "اثنا عشر" (twelve) became "اثنا 10". Preserve spoken words for Arabic
  // and automatic multilingual recognition, where Arabic is also possible.
  const inverseTextNormalization = !!language && language !== 'ar-SA'
  let requestId = options.requestId || crypto.randomUUID()
  const endpoint = env('VOLCENGINE_ASR_ENDPOINT') || DEFAULT_ENDPOINT
  const resourceId = env('VOLCENGINE_ASR_RESOURCE_ID') || DEFAULT_RESOURCE_ID

  let audio: { url?: string; data?: string; format: string; language?: string }
  let extractedAudio = false
  if (isAudioUrl(options.mediaUrl) && !options.localMediaPath && !options.sourceRange) {
    audio = { url: options.mediaUrl, format: path.extname(options.mediaUrl.split('?')[0]).slice(1).toLowerCase() }
  } else {
    const extracted = await extractAudioBase64(options.mediaUrl, options.localMediaPath, options.sourceRange)
    audio = { data: extracted.data, format: 'mp3' }
    extractedAudio = extracted.extractedAudio
  }

  if (language) audio.language = language

  let body: JsonRecord = {}
  let providerLogId: string | undefined
  // Retry only the provider's URL-download failure, once, with the same audio bytes.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: buildHeaders(requestId),
      body: JSON.stringify({
        user: { uid: options.uid || 'makaron-agent' },
        audio,
        request: {
          model_name: 'bigmodel',
          enable_itn: inverseTextNormalization,
          enable_punc: true,
          show_utterances: true,
          ...(!language ? { enable_auto_lang: true } : {}),
        },
      }),
    })

    const bodyText = await res.text()
    try {
      body = JSON.parse(bodyText) as JsonRecord
    } catch {
      body = { raw: bodyText }
    }
    const statusCode = res.headers.get('x-api-status-code')
    const statusMessage = res.headers.get('x-api-message')
    providerLogId = res.headers.get('x-tt-logid') || undefined
    if (res.ok && (!statusCode || statusCode === '20000000')) break
    const msg = statusMessage || (typeof body.message === 'string' ? body.message : bodyText.slice(0, 300))
    if (attempt === 0 && audio.url && /audio download failed|21701/i.test(msg)) {
      const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-asr-retry-'))
      try {
        const inputPath = await downloadMedia(audio.url, workDir)
        const bytes = await readFile(inputPath)
        if (bytes.length > MAX_AUDIO_BASE64_BYTES) throw new Error('Audio is too large for Volcengine ASR binary retry.')
        audio = { data: bytes.toString('base64'), format: audio.format, ...(language ? { language } : {}) }
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
      requestId = crypto.randomUUID()
      continue
    }
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
    requestedLanguage: language,
    asrConfigVersion: ASR_CONFIG_VERSION,
    inverseTextNormalization,
    text,
    durationMs: parseDurationMs(body),
    utterances,
    sourceUrl: options.mediaUrl,
    extractedAudio,
    createdAt: new Date().toISOString(),
  }
}
