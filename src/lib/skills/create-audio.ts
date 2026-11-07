import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getAudioModelCapability,
  resolveAudioRoute,
  SUNO_MUSIC_MODEL_ID,
  validateAudioRequest,
  type AudioGenerationKind,
} from '../audio-model-capabilities'
import {
  generateWithEvolinkSeedAudio,
  type SeedAudioFormat,
} from '../evolink-seed-audio'
import { generateSunoMusic } from '../sunoapi'
import { uploadAudio } from '../supabase/storage'
import type { AudioBillingUsage } from '../billing/audio'

export type { AudioGenerationKind } from '../audio-model-capabilities'
export const SEED_AUDIO_AGENT_PROMPT_MAX_CHARS = 1250

/**
 * Single entry for every generated audio asset (Agent, MCP, HTTP).
 *
 * Routing lives in `resolveAudioRoute`. Suno V6 BGM is switched off by default
 * (`isSunoBgmEnabled`), so every request uses Seed Audio; when enabled,
 * instrumental BGM goes to Suno V6 and everything else stays on Seed Audio.
 */
export interface CreateAudioInput {
  prompt?: string
  kind?: AudioGenerationKind
  /** Music only: `false` requests sung vocals, which stays on Seed Audio. */
  instrumental?: boolean
  /** Optional genre/mood tags appended to the prompt (legacy music style field). */
  style?: string
  targetLanguage?: string
  translatedScript?: string
  durationSeconds?: number
  audioReferences?: string[]
  imageUrls?: string[]
  speechRate?: number
  loudnessRate?: number
  pitchRate?: number
  format?: SeedAudioFormat
  sampleRate?: number
  callbackUrl?: string
  model?: string
  title?: string
  supabase?: SupabaseClient
  userId?: string
  projectId?: string
}

/** One playable result. Providers may return several takes per billed generation. */
export interface AudioTake {
  audioUrl: string
  providerAudioUrl: string
  streamAudioUrl?: string
  duration: number
  title: string
  tags: string
  trackIndex?: number
}

export interface CreateAudioResult {
  success: boolean
  message: string
  taskId?: string
  provider?: string
  model?: string
  /** Fields below mirror takes[0], the default take. */
  title?: string
  audioUrl?: string
  providerAudioUrl?: string
  duration?: number
  trackIndex?: number
  /** Every take in provider order; takes[0] is the default. */
  takes?: AudioTake[]
  generationSeconds?: number
  creditsUsed?: number
  format?: string
  sampleRate?: number
  kind?: AudioGenerationKind
  billing?: AudioBillingUsage
  /** Set when the routed provider failed and Seed Audio produced the result. */
  fallbackFrom?: string
}

interface ProviderAudioResult {
  taskId: string
  provider: string
  model: string
  providerModel: string
  format: SeedAudioFormat
  sampleRate?: number
  generationSeconds: number
  creditsUsed?: number
  takes: Omit<AudioTake, 'providerAudioUrl' | 'trackIndex'>[]
  billing: AudioBillingUsage
}

async function nextTrackIndex(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('project_music')
    .select('track_index')
    .eq('project_id', projectId)
    .order('track_index', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return Number(data?.[0]?.track_index ?? -1) + 1
}

async function persistTakes(input: {
  supabase: SupabaseClient
  userId: string
  projectId: string
  prompt: string
  result: ProviderAudioResult
}): Promise<AudioTake[]> {
  const { supabase, userId, projectId, prompt, result } = input
  const firstTrackIndex = await nextTrackIndex(supabase, projectId)
  const takes: AudioTake[] = []
  for (const [index, take] of result.takes.entries()) {
    const trackIndex = firstTrackIndex + index
    let permanentUrl = take.audioUrl
    try {
      const res = await fetch(take.audioUrl)
      if (res.ok) {
        const buffer = new Uint8Array(await res.arrayBuffer())
        const uploaded = await uploadAudio(supabase, userId, projectId, result.taskId, trackIndex, buffer, result.format)
        if (uploaded) permanentUrl = uploaded
      }
    } catch (err) {
      console.warn('[create_audio] provider audio download/upload failed:', err)
    }

    await supabase.from('project_music').upsert({
      suno_task_id: result.taskId,
      track_index: trackIndex,
      project_id: projectId,
      user_id: userId,
      prompt,
      audio_url: permanentUrl,
      suno_audio_url: take.audioUrl,
      stream_audio_url: take.streamAudioUrl || null,
      duration: take.duration || null,
      title: take.title,
      tags: take.tags,
      status: 'completed',
      selected: false,
    }, { onConflict: 'suno_task_id,track_index' })

    takes.push({ ...take, audioUrl: permanentUrl, providerAudioUrl: take.audioUrl, trackIndex })
  }
  return takes
}

function defaultTitle(kind: AudioGenerationKind, targetLanguage: string): string {
  if (kind === 'voiceover') return 'Generated voiceover'
  if (kind === 'translation') return `Translated ${targetLanguage} voice`
  if (kind === 'mixed') return 'Generated unified soundtrack'
  if (kind === 'music') return 'Generated music'
  return 'Generated audio'
}

function takeTags(kind: AudioGenerationKind, result: Pick<ProviderAudioResult, 'model' | 'provider' | 'providerModel' | 'format' | 'generationSeconds'>, take: number, takeCount: number): string {
  return [
    'audio',
    result.model === SUNO_MUSIC_MODEL_ID ? 'music' : 'seed-audio',
    `kind:${kind}`,
    result.model,
    result.provider,
    result.providerModel,
    `format:${result.format}`,
    `generation:${result.generationSeconds.toFixed(1)}s`,
    takeCount > 1 ? `take:${take}/${takeCount}` : '',
  ].filter(Boolean).join(',')
}

function buildSeedPrompt(input: {
  kind: AudioGenerationKind
  rawPrompt: string
  targetLanguage: string
  translatedScript: string
  instrumental?: boolean
}): string {
  const { kind, rawPrompt, targetLanguage, translatedScript } = input
  if (kind === 'voiceover') {
    return [
      'Mode: isolated voiceover master.',
      'Generate spoken voice only. No music, ambience, sound effects, or sung vocals.',
      rawPrompt,
    ].join('\n')
  }
  if (kind === 'translation') {
    return [
      'Mode: direct speech translation.',
      'Source voice and speech content: @audio1.',
      `Target language: ${targetLanguage}.`,
      translatedScript
        ? `Speak this translated script exactly, without additions or omissions: "${translatedScript}"`
        : 'Translate all spoken content in @audio1. Preserve meaning, claims, numbers, names, order, and emphasis; do not summarize, omit, add, or explain.',
      'Preserve the same speaker identity, age, vocal timbre, conversational tone, emotion, emphasis, pauses, breath pattern, pacing, energy, and microphone distance. Keep natural cross-language pronunciation without turning the delivery into an announcer voice.',
      'Voice only. No music, ambience, sound effects, reverb tail, or sung delivery.',
      rawPrompt ? `Additional direction: ${rawPrompt}` : '',
    ].filter(Boolean).join('\n')
  }
  if (kind === 'mixed') {
    return [
      'Mode: one-pass unified finished soundtrack.',
      'Generate all requested speech, music, ambience, and SFX together in this single synchronized asset and model pass. Preserve exact speech, keep it foreground, and return no stems.',
      rawPrompt,
    ].join('\n')
  }
  if (kind === 'music' && input.instrumental !== false) {
    return [rawPrompt, 'Instrumental background music only, no vocals or lyrics.'].join('\n')
  }
  return rawPrompt
}

async function generateWithSeed(input: CreateAudioInput & { prompt: string }): Promise<ProviderAudioResult> {
  const capability = getAudioModelCapability('evolink-seed-audio')
  const sampleRate = input.sampleRate || capability.defaultSampleRate
  const result = await generateWithEvolinkSeedAudio({
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    audioReferences: input.audioReferences,
    imageUrls: input.imageUrls,
    speechRate: input.speechRate,
    loudnessRate: input.loudnessRate,
    pitchRate: input.pitchRate,
    format: input.format || capability.defaultFormat,
    sampleRate,
    callbackUrl: input.callbackUrl,
  })
  const format = (['mp3', 'wav', 'pcm', 'ogg_opus'].includes(result.format) ? result.format : 'wav') as SeedAudioFormat
  return {
    taskId: result.taskId,
    provider: result.provider,
    model: capability.id,
    providerModel: result.model,
    format,
    sampleRate,
    generationSeconds: result.generationSeconds,
    creditsUsed: result.creditsUsed,
    takes: [{ audioUrl: result.audioUrl, duration: result.duration, title: '', tags: '' }],
    billing: {
      provider: 'evolink',
      model: capability.id,
      providerModel: result.model,
      durationSeconds: result.duration,
      providerCreditsUsed: result.creditsUsed,
      generationSeconds: result.generationSeconds,
    },
  }
}

async function generateWithSuno(input: { prompt: string; title: string; durationSeconds?: number }): Promise<ProviderAudioResult> {
  const result = await generateSunoMusic({
    style: input.prompt,
    title: input.title,
    durationSeconds: input.durationSeconds,
  })
  return {
    taskId: result.taskId,
    provider: result.provider,
    model: SUNO_MUSIC_MODEL_ID,
    providerModel: result.model,
    format: 'mp3',
    generationSeconds: result.generationSeconds,
    takes: result.takes.map(take => ({
      audioUrl: take.audioUrl,
      streamAudioUrl: take.streamAudioUrl,
      duration: take.duration,
      title: take.title,
      tags: '',
    })),
    billing: {
      provider: 'sunoapi',
      model: SUNO_MUSIC_MODEL_ID,
      providerModel: result.model,
      generations: 1,
      generationSeconds: result.generationSeconds,
    },
  }
}

export async function createAudio(input: CreateAudioInput): Promise<CreateAudioResult> {
  const kind = input.kind || 'mixed'
  const basePrompt = input.prompt?.trim() || ''
  const rawPrompt = input.style?.trim()
    ? [basePrompt, `Style tags: ${input.style.trim()}.`].filter(Boolean).join('\n')
    : basePrompt
  const targetLanguage = input.targetLanguage?.trim() || ''
  const translatedScript = input.translatedScript?.trim() || ''
  if (kind !== 'translation' && !rawPrompt) {
    return { success: false, message: 'Audio prompt is required.' }
  }
  if (rawPrompt.length > SEED_AUDIO_AGENT_PROMPT_MAX_CHARS) {
    return {
      success: false,
      message: `Audio prompt must be ${SEED_AUDIO_AGENT_PROMPT_MAX_CHARS} characters or less before the Seed Audio mode wrapper is added.`,
    }
  }
  if (kind === 'translation') {
    if (!targetLanguage) {
      return { success: false, message: 'targetLanguage is required for speech translation.' }
    }
    if (input.audioReferences?.length !== 1) {
      return { success: false, message: 'Speech translation requires exactly one source voice/audio reference.' }
    }
    if (input.imageUrls?.length) {
      return { success: false, message: 'Speech translation cannot use image conditioning.' }
    }
  }

  const route = resolveAudioRoute({
    kind,
    model: input.model,
    instrumental: input.instrumental,
    audioReferenceCount: input.audioReferences?.length,
    imageReferenceCount: input.imageUrls?.length,
  })
  if ('error' in route) return { success: false, message: route.error }

  const title = input.title?.trim() || defaultTitle(kind, targetLanguage)
  const seedPrompt = buildSeedPrompt({ kind, rawPrompt, targetLanguage, translatedScript, instrumental: input.instrumental })
  const validateFor = (modelId: string, prompt: string): string | null => {
    const capability = getAudioModelCapability(modelId)
    if (capability.maxPromptChars && prompt.length > capability.maxPromptChars) {
      return kind === 'translation'
        ? `Translated script and direction must fit within the ${capability.maxPromptChars}-character ${capability.label} prompt limit.`
        : `Audio prompt and mode direction must fit within the ${capability.maxPromptChars}-character ${capability.label} prompt limit.`
    }
    return validateAudioRequest({ model: modelId, durationSeconds: input.durationSeconds })
  }

  let result: ProviderAudioResult
  let promptUsed: string
  let fallbackFrom: string | undefined
  try {
    if (route.modelId === SUNO_MUSIC_MODEL_ID) {
      const validationError = validateFor(SUNO_MUSIC_MODEL_ID, rawPrompt)
      if (validationError) return { success: false, message: validationError }
      try {
        promptUsed = rawPrompt
        result = await generateWithSuno({ prompt: rawPrompt, title, durationSeconds: input.durationSeconds })
      } catch (sunoError) {
        const sunoMessage = sunoError instanceof Error ? sunoError.message : String(sunoError)
        const fallbackError = route.fallbackModelId ? validateFor(route.fallbackModelId, seedPrompt) : 'No fallback model.'
        console.error('[create_audio] Suno failed:', sunoMessage, fallbackError ? `(no fallback: ${fallbackError})` : '(falling back to Seed Audio)')
        if (fallbackError) return { success: false, message: `Failed to create music with Suno V6: ${sunoMessage}` }
        fallbackFrom = SUNO_MUSIC_MODEL_ID
        promptUsed = seedPrompt
        result = await generateWithSeed({ ...input, prompt: seedPrompt })
      }
    } else {
      const validationError = validateFor(route.modelId, seedPrompt)
      if (validationError) return { success: false, message: validationError }
      promptUsed = seedPrompt
      result = await generateWithSeed({ ...input, prompt: seedPrompt })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[create_audio error]', msg)
    return { success: false, message: `Failed to create audio: ${msg}` }
  }

  const takeCount = result.takes.length
  const namedTakes = result.takes.map((take, index) => ({
    ...take,
    title: takeCount > 1 ? `${title} · take ${index + 1}` : title,
    tags: takeTags(kind, result, index + 1, takeCount),
  }))
  const takes: AudioTake[] = input.supabase && input.userId && input.projectId
    ? await persistTakes({
        supabase: input.supabase,
        userId: input.userId,
        projectId: input.projectId,
        prompt: promptUsed,
        result: { ...result, takes: namedTakes },
      })
    : namedTakes.map(take => ({ ...take, providerAudioUrl: take.audioUrl }))

  const primary = takes[0]
  const label = getAudioModelCapability(result.model).label
  return {
    success: true,
    message: [
      `Audio generated with ${label}.`,
      fallbackFrom ? 'Suno V6 was unavailable, so Seed Audio generated this music instead.' : '',
      takeCount > 1 ? `${takeCount} takes returned; take 1 is the default and the others are selectable alternates.` : '',
    ].filter(Boolean).join(' '),
    taskId: result.taskId,
    provider: result.provider,
    model: result.model,
    title: primary?.title,
    audioUrl: primary?.audioUrl,
    providerAudioUrl: primary?.providerAudioUrl,
    duration: primary?.duration,
    trackIndex: primary?.trackIndex,
    takes,
    generationSeconds: result.generationSeconds,
    creditsUsed: result.creditsUsed,
    format: result.format,
    sampleRate: result.sampleRate,
    kind,
    billing: result.billing,
    fallbackFrom,
  }
}
