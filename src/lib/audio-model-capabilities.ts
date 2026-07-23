export interface AudioModelCapability {
  id: string
  label: string
  provider: 'evolink' | 'tts'
  providerModel?: string
  maxDurationSeconds: number
  defaultFormat: 'mp3' | 'wav' | 'pcm' | 'ogg_opus'
  defaultSampleRate: 8000 | 16000 | 24000 | 48000
  maxPromptChars?: number
  maxAudioReferences?: number
  maxImageReferences?: number
  estimatedLatencySeconds?: [number, number]
  recommendedConcurrency?: number
  notes: string[]
}

const DEFAULT_AUDIO_MODEL_ID = 'evolink-seed-audio'

const AUDIO_MODEL_CAPABILITIES: Record<string, AudioModelCapability> = {
  'evolink-seed-audio': {
    id: 'evolink-seed-audio',
    label: 'Seed Audio 1.0',
    provider: 'evolink',
    providerModel: 'doubao-seed-audio-1-0',
    maxDurationSeconds: 120,
    defaultFormat: 'wav',
    defaultSampleRate: 48000,
    maxPromptChars: 1500,
    maxAudioReferences: 3,
    maxImageReferences: 1,
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
  'volcengine-seed-tts': {
    id: 'volcengine-seed-tts',
    label: 'Seed TTS 2.0',
    provider: 'tts',
    maxDurationSeconds: 600,
    defaultFormat: 'mp3',
    defaultSampleRate: 24000,
    estimatedLatencySeconds: [5, 30],
    recommendedConcurrency: 2,
    notes: [
      'Use the dedicated generate_voiceover tool for a dry isolated speech stem, deterministic word-for-word delivery, subtitle-grade timing, or Seed Audio precision fallback.',
      'Best for workflows that require stable selectable voices without music, ambience, or sound effects in the same generation.',
    ],
  },
}

const AUDIO_MODEL_ALIASES: Record<string, string> = {
  seed: 'evolink-seed-audio',
  'seed-audio': 'evolink-seed-audio',
  'seed-audio-1.0': 'evolink-seed-audio',
  'doubao-seed-audio-1-0': 'evolink-seed-audio',
  evolink: 'evolink-seed-audio',
  'evolink-seed': 'evolink-seed-audio',
  suno: 'evolink-seed-audio',
  tts: 'volcengine-seed-tts',
  voiceover: 'volcengine-seed-tts',
}

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
    notes: ['Unknown audio model. The provider adapter must be registered before use.'],
  }
}

export function listAudioModelCapabilities(): AudioModelCapability[] {
  return Object.values(AUDIO_MODEL_CAPABILITIES)
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
  if (options.durationSeconds > capability.maxDurationSeconds) {
    return `${capability.label} duration must be ${capability.maxDurationSeconds} seconds or less.`
  }
  return null
}

export function formatAudioCapabilitiesForAgent(): string {
  return listAudioModelCapabilities()
    .map(capability => [
      `- ${capability.id} (${capability.label}): provider=${capability.provider}${capability.providerModel ? `, model=${capability.providerModel}` : ''}, max=${capability.maxDurationSeconds}s, default=${capability.defaultFormat}/${capability.defaultSampleRate}Hz.`,
      `  Notes: ${capability.notes.join(' ')}`,
    ].join('\n'))
    .join('\n')
}
