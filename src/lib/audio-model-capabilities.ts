import { isSunoConfigured } from './sunoapi'

export type AudioGenerationKind = 'voiceover' | 'dialogue' | 'music' | 'sound_design' | 'mixed' | 'translation'

export interface AudioModelCapability {
  id: string
  label: string
  provider: 'evolink' | 'sunoapi'
  providerModel?: string
  minDurationSeconds?: number
  maxDurationSeconds: number
  defaultFormat: 'mp3' | 'wav' | 'pcm' | 'ogg_opus'
  defaultSampleRate: 8000 | 16000 | 24000 | 48000
  maxPromptChars?: number
  maxAudioReferences?: number
  maxImageReferences?: number
  /** Takes returned by one billed generation. The first take is the default. */
  takesPerGeneration: number
  /** Audio intents this model may serve. Omitted means every intent. */
  kinds?: AudioGenerationKind[]
  estimatedLatencySeconds?: [number, number]
  recommendedConcurrency?: number
  notes: string[]
}

export const SEED_AUDIO_MODEL_ID = 'evolink-seed-audio'
export const SUNO_MUSIC_MODEL_ID = 'suno-v6'
const DEFAULT_AUDIO_MODEL_ID = SEED_AUDIO_MODEL_ID

const AUDIO_MODEL_CAPABILITIES: Record<string, AudioModelCapability> = {
  [SEED_AUDIO_MODEL_ID]: {
    id: SEED_AUDIO_MODEL_ID,
    label: 'Seed Audio 1.0',
    provider: 'evolink',
    providerModel: 'doubao-seed-audio-1-0',
    maxDurationSeconds: 120,
    defaultFormat: 'wav',
    defaultSampleRate: 48000,
    maxPromptChars: 1500,
    maxAudioReferences: 3,
    maxImageReferences: 1,
    takesPerGeneration: 1,
    estimatedLatencySeconds: [20, 45],
    recommendedConcurrency: 1,
    notes: [
      'Use as the default unified model for narration, dialogue, music, sound effects, ambience, and complete mixed sound scenes.',
      'The 2026-07-20 capability position includes fine-grained timeline direction, long-form voice consistency, reference conditioning, and natural generation across 20+ languages.',
      'Current EvoLink gateway accepts up to 3 audio references or 1 image reference, but not both, with a 1,500-character prompt limit.',
      'Use WAV at 48 kHz as the production-master default; request a delivery codec only when needed.',
      'Returned provider URLs are temporary and should be persisted immediately.',
    ],
  },
  [SUNO_MUSIC_MODEL_ID]: {
    id: SUNO_MUSIC_MODEL_ID,
    label: 'Suno V6',
    provider: 'sunoapi',
    providerModel: 'V6',
    minDurationSeconds: 10,
    maxDurationSeconds: 360,
    defaultFormat: 'mp3',
    defaultSampleRate: 48000,
    maxPromptChars: 1000,
    maxAudioReferences: 0,
    maxImageReferences: 0,
    takesPerGeneration: 2,
    kinds: ['music'],
    estimatedLatencySeconds: [25, 60],
    recommendedConcurrency: 2,
    notes: [
      'Used automatically for kind=music instrumental background music without audio or image conditioning; never for speech, songs with vocals, SFX, or mixed soundtracks.',
      'Write the prompt as style direction: genre, mood, instruments, tempo/BPM, energy arc, and ending; no artist names or lyrics. Pass the length as duration_seconds (10-360s).',
      'One generation returns 2 takes: take 1 is the default asset, take 2 is kept as a selectable alternate.',
    ],
  },
}

const AUDIO_MODEL_ALIASES: Record<string, string> = {
  seed: SEED_AUDIO_MODEL_ID,
  'seed-audio': SEED_AUDIO_MODEL_ID,
  'seed-audio-1.0': SEED_AUDIO_MODEL_ID,
  'doubao-seed-audio-1-0': SEED_AUDIO_MODEL_ID,
  evolink: SEED_AUDIO_MODEL_ID,
  'evolink-seed': SEED_AUDIO_MODEL_ID,
  tts: SEED_AUDIO_MODEL_ID,
  voiceover: SEED_AUDIO_MODEL_ID,
  suno: SUNO_MUSIC_MODEL_ID,
  'suno-v6': SUNO_MUSIC_MODEL_ID,
  v6: SUNO_MUSIC_MODEL_ID,
}

/** Normalize an explicit model name. `auto` and empty values mean the Seed Audio default. */
export function normalizeAudioModelId(model?: string | null): string {
  if (!model || model === 'auto') return DEFAULT_AUDIO_MODEL_ID
  const normalized = String(model).trim().toLowerCase()
  return AUDIO_MODEL_ALIASES[normalized] || normalized
}

export function getDefaultAudioModelId(): string {
  return DEFAULT_AUDIO_MODEL_ID
}

export function getAudioModelCapability(model?: string | null): AudioModelCapability {
  const id = normalizeAudioModelId(model)
  return AUDIO_MODEL_CAPABILITIES[id] || {
    id,
    label: id,
    provider: 'evolink',
    maxDurationSeconds: 120,
    defaultFormat: 'mp3',
    defaultSampleRate: 24000,
    takesPerGeneration: 1,
    notes: ['Unknown audio model. The provider adapter must be registered before use.'],
  }
}

export function listAudioModelCapabilities(): AudioModelCapability[] {
  return Object.values(AUDIO_MODEL_CAPABILITIES)
}

export interface AudioRouteInput {
  kind?: AudioGenerationKind
  model?: string | null
  /** Only `false` opts out; music defaults to instrumental. */
  instrumental?: boolean
  audioReferenceCount?: number
  imageReferenceCount?: number
}

export interface AudioRoute {
  modelId: string
  /** Seed Audio model used when the routed provider fails. */
  fallbackModelId?: string
  reason: string
}

/** Pure instrumental BGM is the only intent that leaves Seed Audio. */
export function isInstrumentalBgmRequest(input: AudioRouteInput): boolean {
  return input.kind === 'music'
    && input.instrumental !== false
    && !(input.audioReferenceCount ?? 0)
    && !(input.imageReferenceCount ?? 0)
}

/**
 * Decide which audio model serves a request.
 * - explicit model: honored, Suno is rejected outside instrumental BGM;
 * - auto: instrumental BGM -> Suno V6 (falls back to Seed Audio), everything else -> Seed Audio.
 */
export function resolveAudioRoute(input: AudioRouteInput): AudioRoute | { error: string } {
  const explicit = input.model && input.model !== 'auto' ? normalizeAudioModelId(input.model) : null
  const bgm = isInstrumentalBgmRequest(input)
  if (explicit === SUNO_MUSIC_MODEL_ID) {
    if (!bgm) {
      return { error: 'Suno V6 only generates instrumental background music without audio or image references. Use the default Seed Audio model for speech, vocals, sound design, mixed soundtracks, or conditioned audio.' }
    }
    if (!isSunoConfigured()) return { error: 'Suno V6 is not configured (SUNOAPI_KEY is missing).' }
    return { modelId: SUNO_MUSIC_MODEL_ID, fallbackModelId: SEED_AUDIO_MODEL_ID, reason: 'explicit Suno V6 request' }
  }
  if (explicit) return { modelId: explicit, reason: 'explicit model request' }
  if (bgm && isSunoConfigured()) {
    return { modelId: SUNO_MUSIC_MODEL_ID, fallbackModelId: SEED_AUDIO_MODEL_ID, reason: 'instrumental background music' }
  }
  return { modelId: SEED_AUDIO_MODEL_ID, reason: 'default Seed Audio' }
}

export function validateAudioRequest(options: {
  model?: string | null
  durationSeconds?: number | null
}): string | null {
  const capability = getAudioModelCapability(options.model)
  if (options.durationSeconds == null) return null
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    return 'Audio duration must be a positive number of seconds.'
  }
  if (capability.minDurationSeconds && options.durationSeconds < capability.minDurationSeconds) {
    return `${capability.label} duration must be at least ${capability.minDurationSeconds} seconds.`
  }
  if (options.durationSeconds > capability.maxDurationSeconds) {
    return `${capability.label} duration must be ${capability.maxDurationSeconds} seconds or less.`
  }
  return null
}

export function formatAudioCapabilitiesForAgent(): string {
  return listAudioModelCapabilities()
    .map(capability => [
      `- ${capability.id} (${capability.label}): provider=${capability.provider}${capability.providerModel ? `, model=${capability.providerModel}` : ''}, ${capability.minDurationSeconds ? `${capability.minDurationSeconds}-` : 'max='}${capability.maxDurationSeconds}s, default=${capability.defaultFormat}/${capability.defaultSampleRate}Hz${capability.takesPerGeneration > 1 ? `, ${capability.takesPerGeneration} takes per generation` : ''}.`,
      `  Notes: ${capability.notes.join(' ')}`,
    ].join('\n'))
    .join('\n')
}
