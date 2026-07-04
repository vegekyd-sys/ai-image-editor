import { createHash, createHmac } from 'crypto'

const DEFAULT_SUBMIT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/submit'
const DEFAULT_QUERY_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/query'
const DEFAULT_RESOURCE_ID = 'seed-tts-2.0'
const DEFAULT_VOICE_ID = 'zh_female_vv_uranus_bigtts'
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_OPENAPI_HOST = 'open.volcengineapi.com'
const DEFAULT_OPENAPI_REGION = 'cn-north-1'
const DEFAULT_OPENAPI_SERVICE = 'speech_saas_prod'
const DEFAULT_OPENAPI_VERSION = '2025-05-20'
const VOICE_CACHE_TTL_MS = 10 * 60 * 1000

export const FALLBACK_VOLCENGINE_TTS_VOICES = [
  {
    id: 'zh_female_vv_uranus_bigtts',
    name: 'Vivid female narrator',
    language: 'zh',
    gender: 'female',
    styles: ['natural', 'narration'],
    resourceId: 'seed-tts-2.0',
  },
  {
    id: 'zh_male_dayi_uranus_bigtts',
    name: 'Warm male narrator',
    language: 'zh',
    gender: 'male',
    styles: ['warm', 'narration'],
    resourceId: 'seed-tts-2.0',
  },
  {
    id: 'zh_female_xiaohe_uranus_bigtts',
    name: 'Gentle female narrator',
    language: 'zh',
    gender: 'female',
    styles: ['gentle', 'narration'],
    resourceId: 'seed-tts-2.0',
  },
  {
    id: 'zh_female_shuangkuaisisi_moon_bigtts',
    name: 'Bright energetic female',
    language: 'zh',
    gender: 'female',
    styles: ['bright', 'energetic'],
    resourceId: 'seed-tts-2.0',
  },
] as const

export interface VolcengineTtsVoice {
  id: string
  name?: string
  language?: string
  gender?: string
  styles: string[]
  scenario?: string
  description?: string
  resourceId?: string
  model?: string
  raw?: unknown
}

export interface VolcengineTtsVoiceCatalog {
  provider: 'volcengine'
  source: 'openapi' | 'fallback'
  voices: VolcengineTtsVoice[]
  fetchedAt: string
  warning?: string
}

export interface VolcengineTtsInput {
  text: string
  voiceId?: string
  resourceId?: string
  model?: 'seed-tts-2.0-standard' | 'seed-tts-2.0-expressive'
  uid?: string
  requestId?: string
  format?: 'mp3' | 'ogg_opus' | 'pcm'
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000
  speechRate?: number
  loudnessRate?: number
  emotion?: string
  emotionScale?: number
  enableTimestamp?: boolean
  disableMarkdownFilter?: boolean
  contextTexts?: string[]
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface VolcengineTtsResult {
  provider: 'volcengine'
  model: string
  resourceId: string
  voiceId: string
  requestId: string
  taskId: string
  audio: Uint8Array
  audioUrl: string
  format: 'mp3' | 'ogg_opus' | 'pcm'
  sampleRate: number
  textLength: number
  reqTextLength?: number
  synthesizeTextLength?: number
  sentences: unknown[]
  usage?: unknown
  raw: Record<string, unknown>
}

type JsonRecord = Record<string, unknown>

let voiceCatalogCache: { catalog: VolcengineTtsVoiceCatalog; expiresAt: number } | null = null

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function getApiKey(): string | undefined {
  return (
    env('DOUBAO_SPEECH_API_KEY') ||
    env('VOLCENGINE_TTS_API_KEY') ||
    env('VOLCANO_SPEECH_API_KEY') ||
    env('VOLCENGINE_ASR_API_KEY')
  )
}

function getOpenApiCredentials(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = (
    env('VOLCENGINE_OPENAPI_ACCESS_KEY_ID') ||
    env('VOLCENGINE_ACCESS_KEY_ID') ||
    env('VOLCANO_ACCESS_KEY_ID')
  )
  const secretAccessKey = (
    env('VOLCENGINE_OPENAPI_SECRET_ACCESS_KEY') ||
    env('VOLCENGINE_SECRET_ACCESS_KEY') ||
    env('VOLCANO_SECRET_ACCESS_KEY')
  )
  if (!accessKeyId || !secretAccessKey) return null
  return { accessKeyId, secretAccessKey }
}

function getVoiceId(inputVoiceId?: string): string {
  return (
    inputVoiceId?.trim() ||
    env('DOUBAO_SPEECH_VOICE_TYPE') ||
    env('VOLCENGINE_TTS_VOICE_TYPE') ||
    DEFAULT_VOICE_ID
  )
}

function getResourceId(inputResourceId?: string): string {
  return inputResourceId?.trim() || env('VOLCENGINE_TTS_RESOURCE_ID') || DEFAULT_RESOURCE_ID
}

function buildHeaders(resourceId: string, requestId: string): HeadersInit {
  const headers: Record<string, string> = {
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Control-Require-Usage-Tokens-Return': '*',
    'Content-Type': 'application/json',
  }

  const apiKey = getApiKey()
  if (apiKey) {
    headers['X-Api-Key'] = apiKey
    return headers
  }

  const appId = env('VOLCENGINE_TTS_APP_ID')
  const accessKey = env('VOLCENGINE_TTS_ACCESS_KEY')
  if (appId && accessKey) {
    headers['X-Api-App-Id'] = appId
    headers['X-Api-Access-Key'] = accessKey
    return headers
  }

  throw new Error('Missing Volcengine TTS credentials. Set DOUBAO_SPEECH_API_KEY, VOLCENGINE_TTS_API_KEY, VOLCANO_SPEECH_API_KEY, or VOLCENGINE_TTS_APP_ID + VOLCENGINE_TTS_ACCESS_KEY.')
}

function sanitizeSpeechRate(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(-50, Math.min(100, Math.round(value)))
}

function buildSubmitBody(input: VolcengineTtsInput, requestId: string, voiceId: string): JsonRecord {
  const audioParams: JsonRecord = {
    format: input.format || 'mp3',
    sample_rate: input.sampleRate || 24000,
    speech_rate: sanitizeSpeechRate(input.speechRate),
    enable_timestamp: input.enableTimestamp ?? true,
  }
  if (input.loudnessRate !== undefined) audioParams.loudness_rate = input.loudnessRate
  if (input.emotion) audioParams.emotion = input.emotion
  if (input.emotionScale !== undefined) audioParams.emotion_scale = input.emotionScale

  const additions: JsonRecord = {
    disable_markdown_filter: input.disableMarkdownFilter ?? false,
  }
  if (input.contextTexts?.length) additions.context_texts = input.contextTexts.slice(0, 1)

  const reqParams: JsonRecord = {
    text: input.text,
    speaker: voiceId,
    audio_params: audioParams,
    additions: JSON.stringify(additions),
  }
  if (input.model) reqParams.model = input.model

  return {
    user: { uid: input.uid || 'makaron-agent' },
    unique_id: requestId,
    req_params: reqParams,
  }
}

async function parseJsonResponse(res: Response, label: string): Promise<JsonRecord> {
  const text = await res.text()
  let body: JsonRecord
  try {
    body = JSON.parse(text) as JsonRecord
  } catch {
    body = { raw: text }
  }
  const code = body.code
  if (!res.ok || code !== 20000000) {
    const message = typeof body.message === 'string' ? body.message : text.slice(0, 300)
    throw new Error(`Volcengine TTS ${label} failed (${res.status}${code ? `/${code}` : ''}): ${message}${diagnosticHint(message)}`)
  }
  return body
}

function diagnosticHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalid x-api-key') || lower.includes('invalid key')) {
    return ' (check that the key is a Seed Speech API key, not an Ark model key)'
  }
  if (lower.includes('grant') || lower.includes('resource') || lower.includes('permission')) {
    return ' (check X-Api-Resource-Id and voice/resource authorization)'
  }
  if (lower.includes('speaker')) {
    return ' (check voice_id/speaker authorization for the selected resource)'
  }
  return ''
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalizeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function signVolcengineOpenApiRequest(options: {
  method: 'POST' | 'GET'
  host: string
  path: string
  query: Record<string, string>
  body: string
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  now?: Date
}): Record<string, string> {
  const now = options.now || new Date()
  const xDate = formatAmzDate(now)
  const shortDate = xDate.slice(0, 8)
  const payloadHash = sha256Hex(options.body)
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${options.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    '',
  ].join('\n')
  const canonicalRequest = [
    options.method,
    options.path,
    canonicalizeQuery(options.query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${shortDate}/${options.region}/${options.service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const kDate = hmac(options.secretAccessKey, shortDate)
  const kRegion = hmac(kDate, options.region)
  const kService = hmac(kRegion, options.service)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  return {
    'Content-Type': 'application/json',
    Host: options.host,
    'X-Date': xDate,
    'X-Content-Sha256': payloadHash,
    Authorization: `HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

function stringFromFields(record: JsonRecord, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function arrayFromFields(record: JsonRecord, fields: string[]): string[] {
  const values: string[] = []
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) values.push(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) values.push(item)
        if (item && typeof item === 'object') {
          values.push(...arrayFromFields(item as JsonRecord, ['Category', 'Categories', 'Emotion', 'EmotionType', 'Name', 'Label', 'Tag']))
        }
      }
    }
  }
  return [...new Set(values.flatMap(value => value.split(/[、,，/|;；\s]+/).map(item => item.trim()).filter(Boolean)))]
}

function collectVoiceCandidates(value: unknown, out: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectVoiceCandidates(item, out)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as JsonRecord
  const id = stringFromFields(record, ['Speaker', 'speaker', 'SpeakerID', 'SpeakerId', 'speaker_id', 'voice_type', 'VoiceType', 'VoiceId', 'voice_id'])
  if (id) out.push(record)
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectVoiceCandidates(nested, out)
  }
}

function normalizeVoice(record: JsonRecord): VolcengineTtsVoice | null {
  const id = stringFromFields(record, ['VoiceType', 'voice_type', 'SpeakerID', 'SpeakerId', 'Speaker', 'speaker', 'VoiceId', 'voice_id', 'speaker_id', 'ID', 'id'])
  if (!id) return null
  const styles = arrayFromFields(record, ['Style', 'style', 'Styles', 'styles', 'Tag', 'Tags', 'tags', 'Category', 'Categories', 'category', 'Scenario', 'scenario', 'TimbreTag', 'timbre_tag', 'NormalLabels', 'SpecialLabels', 'Age'])
  return {
    id,
    name: stringFromFields(record, ['Name', 'name', 'DisplayName', 'display_name', 'SpeakerName', 'speaker_name', 'TimbreName', 'timbre_name']),
    language: stringFromFields(record, ['Language', 'language', 'Lang', 'lang', 'Locale', 'locale']),
    gender: stringFromFields(record, ['Gender', 'gender', 'Sex', 'sex']),
    styles,
    scenario: stringFromFields(record, ['Scenario', 'scenario', 'Scene', 'scene', 'UseCase', 'use_case']),
    description: stringFromFields(record, ['Description', 'description', 'Desc', 'desc', 'Introduction', 'introduction']),
    resourceId: stringFromFields(record, ['ResourceId', 'ResourceID', 'resource_id', 'Resource', 'resource']) || DEFAULT_RESOURCE_ID,
    model: stringFromFields(record, ['Model', 'model', 'ModelName', 'model_name']),
    raw: record,
  }
}

function normalizeBigModelTimbres(payload: JsonRecord): VolcengineTtsVoice[] {
  const result = payload.Result && typeof payload.Result === 'object' ? payload.Result as JsonRecord : payload
  const timbres = Array.isArray(result.Timbres) ? result.Timbres : []
  const voices: VolcengineTtsVoice[] = []
  for (const item of timbres) {
    if (!item || typeof item !== 'object') continue
    const timbre = item as JsonRecord
    const id = stringFromFields(timbre, ['SpeakerID', 'SpeakerId', 'Speaker', 'VoiceType'])
    if (!id) continue
    const infos = Array.isArray(timbre.TimbreInfos) ? timbre.TimbreInfos.filter(info => info && typeof info === 'object') as JsonRecord[] : []
    const info = infos[0] || {}
    const emotions = infos.flatMap(entry => Array.isArray(entry.Emotions) ? entry.Emotions : [])
      .filter(emotion => emotion && typeof emotion === 'object') as JsonRecord[]
    const categories = infos.flatMap(entry => Array.isArray(entry.Categories) ? entry.Categories : [])
      .filter(category => category && typeof category === 'object') as JsonRecord[]
    const styles = [
      ...arrayFromFields(info, ['Age', 'Categories', 'NormalLabels', 'SpecialLabels']),
      ...categories.flatMap(category => arrayFromFields(category, ['Category', 'Categories'])),
      ...emotions.flatMap(emotion => arrayFromFields(emotion, ['Emotion', 'EmotionType'])),
    ]
    const demoText = stringFromFields(emotions[0] || {}, ['DemoText'])
    voices.push({
      id,
      name: stringFromFields(info, ['SpeakerName', 'Name', 'TimbreName']),
      gender: stringFromFields(info, ['Gender', 'Sex']),
      styles: [...new Set(styles)].filter(Boolean),
      scenario: categories.map(category => stringFromFields(category, ['Category']) || '').filter(Boolean).join(', ') || undefined,
      description: demoText,
      resourceId: id.startsWith('ICL_') ? 'seed-icl-2.0' : DEFAULT_RESOURCE_ID,
      raw: timbre,
    })
  }
  return voices
}

function fallbackVoiceCatalog(warning?: string): VolcengineTtsVoiceCatalog {
  return {
    provider: 'volcengine',
    source: 'fallback',
    voices: FALLBACK_VOLCENGINE_TTS_VOICES.map(voice => ({ ...voice, styles: [...voice.styles] })),
    fetchedAt: new Date().toISOString(),
    warning,
  }
}

async function callVolcengineSpeechOpenApi(
  action: string,
  bodyPayload: JsonRecord,
  credentials: { accessKeyId: string; secretAccessKey: string },
): Promise<JsonRecord> {
  const host = env('VOLCENGINE_OPENAPI_HOST') || DEFAULT_OPENAPI_HOST
  const region = env('VOLCENGINE_OPENAPI_REGION') || DEFAULT_OPENAPI_REGION
  const service = env('VOLCENGINE_OPENAPI_SERVICE') || DEFAULT_OPENAPI_SERVICE
  const version = env('VOLCENGINE_SPEECH_OPENAPI_VERSION') || DEFAULT_OPENAPI_VERSION
  const query = { Action: action, Version: version }
  const body = JSON.stringify(bodyPayload)
  const headers = signVolcengineOpenApiRequest({
    method: 'POST',
    host,
    path: '/',
    query,
    body,
    region,
    service,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  })

  const res = await fetch(`https://${host}/?${canonicalizeQuery(query)}`, {
    method: 'POST',
    headers,
    body,
  })
  const text = await res.text()
  let payload: JsonRecord
  try {
    payload = JSON.parse(text) as JsonRecord
  } catch {
    payload = { raw: text }
  }
  const responseMeta = payload.ResponseMetadata && typeof payload.ResponseMetadata === 'object'
    ? payload.ResponseMetadata as JsonRecord
    : undefined
  const errorMeta = responseMeta?.Error && typeof responseMeta.Error === 'object'
    ? responseMeta.Error as JsonRecord
    : undefined
  if (!res.ok || errorMeta) {
    const message = stringFromFields(errorMeta || payload, ['Message', 'message', 'Code', 'code']) || text.slice(0, 300)
    throw new Error(`Volcengine ${action} failed (${res.status}): ${message}`)
  }
  return payload
}

export async function listVolcengineTtsVoices(options: { forceRefresh?: boolean; allowFallback?: boolean } = {}): Promise<VolcengineTtsVoiceCatalog> {
  if (!options.forceRefresh && voiceCatalogCache && Date.now() < voiceCatalogCache.expiresAt) {
    return voiceCatalogCache.catalog
  }

  const credentials = getOpenApiCredentials()
  if (!credentials) {
    if (options.allowFallback === false) {
      throw new Error('Missing Volcengine OpenAPI credentials. Set VOLCENGINE_ACCESS_KEY_ID + VOLCENGINE_SECRET_ACCESS_KEY to call ListSpeakers.')
    }
    return fallbackVoiceCatalog('Missing Volcengine OpenAPI AK/SK; using a small fallback voice list.')
  }

  const payloads: JsonRecord[] = []
  const errors: string[] = []
  for (const action of ['ListSpeakers', 'ListBigModelTTSTimbres']) {
    try {
      payloads.push(await callVolcengineSpeechOpenApi(action, {}, credentials))
    } catch (e) {
      errors.push(`${action}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const candidates: JsonRecord[] = []
  for (const payload of payloads) collectVoiceCandidates(payload.Result ?? payload.result ?? payload, candidates)
  const byId = new Map<string, VolcengineTtsVoice>()
  for (const candidate of candidates) {
    const voice = normalizeVoice(candidate)
    if (voice) byId.set(voice.id, voice)
  }
  for (const payload of payloads) {
    for (const voice of normalizeBigModelTimbres(payload)) {
      byId.set(voice.id, voice)
    }
  }
  const voices = [...byId.values()]
  if (!voices.length) {
    const message = errors.length ? errors.join('; ') : 'Volcengine voice list APIs returned no recognizable voices.'
    if (options.allowFallback === false) throw new Error(message)
    return fallbackVoiceCatalog(`${message}; using fallback.`)
  }

  const catalog: VolcengineTtsVoiceCatalog = {
    provider: 'volcengine',
    source: 'openapi',
    voices,
    fetchedAt: new Date().toISOString(),
    warning: errors.length ? errors.join('; ') : undefined,
  }
  voiceCatalogCache = { catalog, expiresAt: Date.now() + VOICE_CACHE_TTL_MS }
  return catalog
}

async function pollTask(taskId: string, headers: HeadersInit, timeoutMs: number, pollIntervalMs: number): Promise<JsonRecord> {
  const queryEndpoint = env('VOLCENGINE_TTS_QUERY_ENDPOINT') || DEFAULT_QUERY_ENDPOINT
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    const res = await fetch(queryEndpoint, {
      method: 'POST',
      headers: {
        ...(headers as Record<string, string>),
        'X-Api-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify({ task_id: taskId }),
    })
    const body = await parseJsonResponse(res, 'query')
    const data = body.data && typeof body.data === 'object' ? body.data as JsonRecord : {}
    const status = Number(data.task_status)
    if (status === 2) return body
    if (status === 3) {
      throw new Error(`Volcengine TTS task failed: ${typeof body.message === 'string' ? body.message : 'unknown error'}`)
    }
  }
  throw new Error(`Volcengine TTS task timed out after ${Math.round(timeoutMs / 1000)}s`)
}

export async function synthesizeWithVolcengineTts(input: VolcengineTtsInput): Promise<VolcengineTtsResult> {
  const text = input.text.trim()
  if (!text) throw new Error('TTS text is required')

  const requestId = input.requestId || crypto.randomUUID()
  const resourceId = getResourceId(input.resourceId)
  const voiceId = getVoiceId(input.voiceId)
  const format = input.format || 'mp3'
  const sampleRate = input.sampleRate || 24000
  const headers = buildHeaders(resourceId, requestId)
  const submitEndpoint = env('VOLCENGINE_TTS_SUBMIT_ENDPOINT') || DEFAULT_SUBMIT_ENDPOINT

  const submitRes = await fetch(submitEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildSubmitBody({ ...input, text, format, sampleRate }, requestId, voiceId)),
  })
  const submitBody = await parseJsonResponse(submitRes, 'submit')
  const submitData = submitBody.data && typeof submitBody.data === 'object' ? submitBody.data as JsonRecord : {}
  const taskId = typeof submitData.task_id === 'string' ? submitData.task_id : ''
  if (!taskId) throw new Error('Volcengine TTS submit succeeded but did not return data.task_id')

  const queryBody = await pollTask(
    taskId,
    headers,
    input.timeoutMs || DEFAULT_TIMEOUT_MS,
    input.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS,
  )
  const data = queryBody.data && typeof queryBody.data === 'object' ? queryBody.data as JsonRecord : {}
  const audioUrl = typeof data.audio_url === 'string' ? data.audio_url : ''
  if (!audioUrl) throw new Error('Volcengine TTS task completed but did not return data.audio_url')

  const audioRes = await fetch(audioUrl)
  if (!audioRes.ok) throw new Error(`Failed to download Volcengine TTS audio (${audioRes.status})`)
  const audio = new Uint8Array(await audioRes.arrayBuffer())

  return {
    provider: 'volcengine',
    model: input.model || resourceId,
    resourceId,
    voiceId,
    requestId,
    taskId,
    audio,
    audioUrl,
    format,
    sampleRate,
    textLength: text.length,
    reqTextLength: typeof data.req_text_length === 'number' ? data.req_text_length : undefined,
    synthesizeTextLength: typeof data.synthesize_text_length === 'number' ? data.synthesize_text_length : undefined,
    sentences: Array.isArray(data.sentences) ? data.sentences : [],
    usage: data.usage,
    raw: queryBody,
  }
}
