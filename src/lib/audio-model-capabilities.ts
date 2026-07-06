export interface AudioModelCapability {
  id: string
  label: string
  provider: 'evolink' | 'tts'
  providerModel?: string
  maxDurationSeconds: number
  defaultFormat: 'mp3' | 'wav'
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
    defaultFormat: 'mp3',
    estimatedLatencySeconds: [20, 45],
    recommendedConcurrency: 1,
    notes: [
      'Prompt can describe music, sound effects, ambience, character voice, or mixed sound design.',
      'Use as the default prompt-driven audio generation model for short-video sound design.',
      'Returned provider URLs are temporary and should be persisted immediately.',
    ],
  },
  'volcengine-seed-tts': {
    id: 'volcengine-seed-tts',
    label: 'Seed TTS 2.0',
    provider: 'tts',
    maxDurationSeconds: 600,
    defaultFormat: 'mp3',
    estimatedLatencySeconds: [5, 30],
    recommendedConcurrency: 2,
    notes: [
      'Use the dedicated generate_voiceover tool when exact scripted narration is required.',
      'Best for explainer video narration, tutorial voiceover, and stable selectable voices.',
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
      `- ${capability.id} (${capability.label}): provider=${capability.provider}${capability.providerModel ? `, model=${capability.providerModel}` : ''}, max=${capability.maxDurationSeconds}s.`,
      `  Notes: ${capability.notes.join(' ')}`,
    ].join('\n'))
    .join('\n')
}
