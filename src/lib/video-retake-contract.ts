import { normalizeVideoModelId } from './video-model-capabilities'

export const RETAKE_MODELS = ['seedance-2.5', 'fal-h3-max'] as const
export type RetakeModel = typeof RETAKE_MODELS[number]
export const DEFAULT_RETAKE_MODEL: RetakeModel = 'fal-h3-max'
export interface RetakeRange { start: number; end: number }
export interface RetakePlan extends RetakeRange {
  sourceDuration: number
  contextStart: number
  contextEnd: number
  patchOffset: number
  generationDuration: number
  model: RetakeModel
}

export function resolveRetakeModel(model?: string | null): RetakeModel {
  const id = model && model !== 'auto' ? normalizeVideoModelId(model) : DEFAULT_RETAKE_MODEL
  if (!RETAKE_MODELS.includes(id as RetakeModel)) {
    throw new Error('Retake supports Seedance 2.5 and FAL H3 Max. H3 Turbo does not accept source video. Choose a supported model explicitly.')
  }
  return id as RetakeModel
}

export function validateRetakeRange(range: RetakeRange, duration?: number): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
    throw new Error('Retake requires finite seconds with 0 <= start < end.')
  }
  if (range.end - range.start < .1 || range.end - range.start > 15) {
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
  const length = range.end - range.start
  const contextLength = Math.min(sourceDuration, 15, Math.max(length, selectedModel === 'fal-h3-max' ? 5 : 4))
  const contextStart = Math.max(0, Math.min(range.start - (contextLength - length) / 2, sourceDuration - contextLength))
  const contextEnd = Math.min(sourceDuration, contextStart + contextLength)
  return { ...range, sourceDuration, model: selectedModel, contextStart, contextEnd,
    patchOffset: range.start - contextStart,
    generationDuration: selectedModel === 'fal-h3-max' ? Math.min(15, Math.max(5, Math.ceil(contextLength))) : contextLength }
}

export function retakePrompt(instruction: string, plan: RetakePlan, anchored = false): string {
  if (!instruction.trim()) throw new Error('Describe what to change in the selected interval.')
  if (plan.model === 'fal-h3-max') {
    const scale = plan.generationDuration / (plan.contextEnd - plan.contextStart)
    const from = plan.patchOffset * scale
    const to = (plan.end - plan.contextStart) * scale
    return `Generate a NEW TAKE, ${plan.generationDuration.toFixed(3)} seconds long. Video 1 supplies the subject identities, visual style, environment and action context; it is not a shot list to copy. Apply this requested change as the primary objective: ${instruction.trim()}\nTIMEBASE: Video 1 covers original source ${plan.contextStart.toFixed(3)}-${plan.contextEnd.toFixed(3)} seconds. Convert original timestamps to output seconds with (original timestamp - ${plan.contextStart.toFixed(3)}) * ${scale.toFixed(6)}. Apply the change within output ${from.toFixed(3)}-${to.toFixed(3)} seconds; preserve any contextual lead-in and tail outside that window.\nEDIT PRIORITY: Preserve only aspects the request does not change. If new camera angles or cuts are requested, replace the source camera coverage with those shots; do not recreate the original continuous shot. Use visible hard cuts between requested setups, not a zoom, orbit or split screen. Keep the same subjects and action progressing through each cut. No unrequested text, subjects or ending. The application preserves the original full-video audio and footage outside the selection.` + (anchored
      ? '\nBOUNDARY CONTINUITY: <<<media_1>>> supplies the opening action state; <<<media_2>>> supplies the ending action state. Begin with the action already in progress, never restart an earlier approach. Match those states briefly at the boundaries; they do not lock the camera composition of the intervening shots. Finish at the ending state while performing the requested edit between the boundaries.' : '')
  }
  return `Edit the supplied source clip. This clip covers original source time ${plan.contextStart.toFixed(3)}-${plan.contextEnd.toFixed(3)} seconds. Subtract ${plan.contextStart.toFixed(3)} seconds from any original source timestamps in the instruction to obtain clip-local timestamps. Only change clip-local ${plan.patchOffset.toFixed(3)}-${(plan.end - plan.contextStart).toFixed(3)} seconds: ${instruction.trim()}\nPreserve subject identity, motion, lighting and every detail the instruction does not explicitly change. Preserve camera and framing unless the instruction requests new camera angles. Follow explicitly requested shot cuts within the selected interval; otherwise keep the original shot. Keep the action timing and continuity with both ends of the source clip. Do not add unrequested shots, captions or a new ending.` + (anchored
    ? '\nBOUNDARY CONTINUITY: <<<media_1>>> is the exact opening state; <<<media_2>>> is the exact ending state. Begin at the action already in progress in <<<media_1>>> and continue its momentum. Never restart an approach, establishing setup or action that already happened before this clip. Requested camera cuts may change viewpoint, but must advance the same action without replaying its beginning. Finish at <<<media_2>>>.' : '')
}
