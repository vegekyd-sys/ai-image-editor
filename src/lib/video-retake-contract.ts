import { normalizeVideoModelId } from './video-model-capabilities'

export const RETAKE_MODELS = ['seedance-2.5-eco', 'seedance-2.5', 'fal-h3-max', 'kling-4', 'wan-3.0', 'wan-3.0-prime'] as const
export type RetakeModel = typeof RETAKE_MODELS[number]
export const DEFAULT_RETAKE_MODEL: RetakeModel = 'kling-4'
export interface RetakeRange { start: number; end: number }
export type RetakeAudioMode = 'original' | 'generated'
export interface RetakePlan extends RetakeRange {
  /** Omitted on old jobs: keep the complete source soundtrack. */
  audioMode?: RetakeAudioMode
  sourceDuration: number
  contextStart: number
  contextEnd: number
  patchOffset: number
  generationDuration: number
  model: RetakeModel
  /** Absent on persisted legacy jobs: their patch represents the full context. */
  outputMode?: 'selection'
}

export function resolveRetakeModel(model?: string | null): RetakeModel {
  const id = model && model !== 'auto' ? normalizeVideoModelId(model) : DEFAULT_RETAKE_MODEL
  if (!RETAKE_MODELS.includes(id as RetakeModel)) {
    throw new Error('Retake supports Seedance 2.5 Eco, Seedance 2.5, FAL H3 Max, Kling 4.0 and Wan 3.0 Standard/Prime. H3 Turbo does not accept source video. Choose a supported model explicitly.')
  }
  return id as RetakeModel
}

export function validateRetakeRange(range: RetakeRange, duration?: number): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
    throw new Error('Retake requires finite seconds with 0 <= start < end.')
  }
  if (range.end - range.start < .1 - 1e-9 || range.end - range.start > 15 + 1e-9) {
    throw new Error('Select a Retake interval between 0.1 and 15 seconds.')
  }
  if (duration != null && (!Number.isFinite(duration) || duration <= 0 || range.end > duration + .001)) {
    throw new Error('The Retake interval exceeds the source video duration.')
  }
}

/** Expand only model context, never the interval replaced in the user's video. */
export function planRetake(range: RetakeRange, sourceDuration: number, model?: string): RetakePlan {
  validateRetakeRange(range, sourceDuration)
  const selectedModel = resolveRetakeModel(model)
  if (selectedModel === 'fal-h3-max' && sourceDuration < 2) throw new Error('FAL H3 Max requires at least two seconds of source video.')
  if (selectedModel.startsWith('wan-3.0') && sourceDuration < 1) throw new Error('Wan Retake requires at least one second of source video.')
  if (selectedModel === 'kling-4' && sourceDuration < 3) throw new Error('Kling 4.0 Retake requires at least three seconds of source video.')
  const length = range.end - range.start
  const wan = selectedModel.startsWith('wan-3.0')
  const integerContext = selectedModel === 'kling-4' || wan
  const minimumContext = wan ? 2 : selectedModel === 'kling-4' ? 3 : selectedModel === 'fal-h3-max' ? 5 : 4
  const contextLength = Math.min(sourceDuration, 15, Math.max(minimumContext, integerContext ? Math.ceil(length) : length))
  const contextStart = Math.max(0, Math.min(range.start - (contextLength - length) / 2, sourceDuration - contextLength))
  const contextEnd = Math.min(sourceDuration, contextStart + contextLength)
  return { ...range, sourceDuration, model: selectedModel, contextStart, contextEnd,
    patchOffset: selectedModel === 'fal-h3-max' ? 0 : range.start - contextStart,
    ...(selectedModel === 'fal-h3-max' ? { outputMode: 'selection' as const } : {}),
    generationDuration: selectedModel === 'fal-h3-max' ? Math.min(15, Math.max(5, Math.ceil(length))) : integerContext ? Math.max(minimumContext, Math.ceil(contextLength)) : contextLength }
}

/** The Agent writes the final instruction after inspection, in output seconds.
 * The backend handles media preparation/assembly; it adds no creative rules. */
export function retakePrompt(instruction: string): string {
  if (!instruction.trim()) throw new Error('Describe what to change in the selected interval.')
  return instruction.trim()
}
