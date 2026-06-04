export interface VideoModelCapability {
  id: string
  label: string
  minOutputDuration: number
  maxOutputDuration: number
  maxReferenceVideoDuration: number
  supportsVideoReference: boolean
  supportsBaseVideoEdit: boolean
  longVideoChunkSeconds: number
  estimatedCostPerSecondUsd?: number
}

const DEFAULT_MODEL_ID = 'seedance'

const MODEL_CAPABILITIES: Record<string, VideoModelCapability> = {
  kling: {
    id: 'kling',
    label: 'Kling',
    minOutputDuration: 5,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 10.5,
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.112,
  },
  seedance: {
    id: 'seedance',
    label: 'SeeDance',
    minOutputDuration: 4,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 15.5,
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.161,
  },
  piapi: {
    id: 'piapi',
    label: 'PiAPI Kling',
    minOutputDuration: 5,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 0,
    supportsVideoReference: false,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.112,
  },
}

const GENERIC_VIDEO_MODEL: VideoModelCapability = {
  id: 'generic',
  label: 'Video model',
  minOutputDuration: 4,
  maxOutputDuration: 15,
  maxReferenceVideoDuration: 15.5,
  supportsVideoReference: true,
  supportsBaseVideoEdit: false,
  longVideoChunkSeconds: 15,
}

export function normalizeVideoModelId(model?: string | null): string {
  return model || process.env.ANIMATE_PROVIDER || DEFAULT_MODEL_ID
}

export function getDefaultVideoModelId(): string {
  return DEFAULT_MODEL_ID
}

export function getVideoModelCapability(model?: string | null): VideoModelCapability {
  const id = normalizeVideoModelId(model)
  return MODEL_CAPABILITIES[id] || { ...GENERIC_VIDEO_MODEL, id, label: id }
}

export function listVideoModelCapabilities(): VideoModelCapability[] {
  return Object.values(MODEL_CAPABILITIES)
}

export function resolveVideoOutputDuration(options: {
  requestedDuration?: number
  referenceVideoDuration?: number
  model?: string | null
}): number | undefined {
  const capability = getVideoModelCapability(options.model)
  if (options.requestedDuration != null) return options.requestedDuration
  if (options.referenceVideoDuration != null) {
    return Math.min(capability.maxOutputDuration, Math.round(options.referenceVideoDuration))
  }
  return undefined
}

export function validateVideoModelRequest(options: {
  model?: string | null
  outputDuration?: number
  referenceVideoDuration?: number
  hasVideoReference?: boolean
}): string | null {
  const capability = getVideoModelCapability(options.model)

  if (options.outputDuration != null && options.outputDuration < capability.minOutputDuration) {
    return `${capability.label} duration must be ${capability.minOutputDuration} seconds or more.`
  }

  if (options.outputDuration != null && options.outputDuration > capability.maxOutputDuration) {
    return `${capability.label} duration must be ${capability.maxOutputDuration} seconds or less.`
  }

  if (options.hasVideoReference && !capability.supportsVideoReference) {
    return `${capability.label} does not support reference videos. Choose a model with video-reference support, or use run_code runtime="node" for non-generative MP4 processing.`
  }

  if (options.referenceVideoDuration != null && options.referenceVideoDuration > capability.maxReferenceVideoDuration) {
    return `${capability.label} reference video duration must be ${capability.maxReferenceVideoDuration.toFixed(1).replace(/\.0$/, '')} seconds or less. Read skills/video-ffmpeg-lab/SKILL.md, then use run_code runtime="node" with FFmpeg to split the source video first, submit one generation task per chunk, and concatenate the results.`
  }

  return null
}
