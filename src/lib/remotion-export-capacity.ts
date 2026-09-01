import type { DesignPayload } from '@/types'

export const DEFAULT_REMOTION_LAMBDA_FRAMES_PER_LAMBDA = 20
export const MAX_REMOTION_LAMBDAS_PER_RENDER = 200
export const DEFAULT_REMOTION_EXPORT_CAPACITY = 330
export const DEFAULT_REMOTION_EXPORT_LEGACY_JOB_SLOTS = 46

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : fallback
}

export function resolveFramesPerLambda(
  durationInFrames: number,
  configuredFramesPerLambda = DEFAULT_REMOTION_LAMBDA_FRAMES_PER_LAMBDA,
): number {
  return Math.max(
    positiveInteger(configuredFramesPerLambda, DEFAULT_REMOTION_LAMBDA_FRAMES_PER_LAMBDA),
    Math.ceil(Math.max(1, durationInFrames) / MAX_REMOTION_LAMBDAS_PER_RENDER),
  )
}

export function resolveRemotionExportCapacityLimit(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return positiveInteger(env.REMOTION_EXPORT_LAMBDA_CAPACITY, DEFAULT_REMOTION_EXPORT_CAPACITY)
}

export function estimateRemotionExportLambdaSlots(
  design: Pick<DesignPayload, 'animation'>,
  outputType: 'video' | 'image',
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  estimatedLambdaSlots: number
  durationInFrames: number
  framesPerLambda: number | null
  rendererLambdaSlots: number
  controlLambdaSlots: number
} {
  if (outputType === 'image') {
    return {
      estimatedLambdaSlots: 1,
      durationInFrames: 1,
      framesPerLambda: null,
      rendererLambdaSlots: 0,
      controlLambdaSlots: 1,
    }
  }

  const fps = positiveInteger(design.animation?.fps, 30)
  const durationSeconds = Number(design.animation?.durationInSeconds)
  const durationInFrames = Math.max(
    1,
    Math.round(fps * (Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1 / fps)),
  )
  const framesPerLambda = resolveFramesPerLambda(
    durationInFrames,
    positiveInteger(
      env.REMOTION_LAMBDA_FRAMES_PER_LAMBDA,
      DEFAULT_REMOTION_LAMBDA_FRAMES_PER_LAMBDA,
    ),
  )
  const rendererLambdaSlots = Math.max(1, Math.ceil(durationInFrames / framesPerLambda))
  const controlLambdaSlots = 1

  return {
    estimatedLambdaSlots: rendererLambdaSlots + controlLambdaSlots,
    durationInFrames,
    framesPerLambda,
    rendererLambdaSlots,
    controlLambdaSlots,
  }
}
