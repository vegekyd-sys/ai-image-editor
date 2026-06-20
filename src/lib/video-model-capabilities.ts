export interface VideoModelCapability {
  id: string
  label: string
  minOutputDuration: number
  maxOutputDuration: number
  maxReferenceVideoDuration: number
  referenceVideoSize?: VideoReferenceSizeCapability
  supportsVideoReference: boolean
  supportsBaseVideoEdit: boolean
  longVideoChunkSeconds: number
  estimatedCostPerSecondUsd?: number
  estimatedInputCostUsdPerImage?: number
  maxImageReferences?: number
  supportedResolutions?: VideoResolution[]
  defaultResolution?: VideoResolution
  estimatedCostPerSecondUsdByResolution?: Partial<Record<VideoResolution, number>>
  provider?: 'kling' | 'seedance' | 'grok' | 'piapi'
  providerModel?: string
}

export type VideoResolution = '480p' | '720p' | '1080p' | '4k'
export type VideoResolutionInput = VideoResolution | 'auto' | null | undefined

export interface VideoGenerationRoute {
  model: string
  label: string
  provider: 'kling' | 'seedance' | 'grok' | 'piapi' | string
  providerModel?: string
  providerMode?: 'std' | 'pro' | '4k'
  resolution: VideoResolution
  estimatedCostPerSecondUsd?: number
  estimatedInputCostUsdPerImage?: number
}

export interface VideoReferenceSizeCapability {
  maxFileSizeMb?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  minAspectRatio?: number
  maxAspectRatio?: number
  minFramePixels?: number
  maxFramePixels?: number
  description: string
}

export interface VideoReferenceMeta {
  width?: number | null
  height?: number | null
  fileSizeBytes?: number | null
}

const DEFAULT_MODEL_ID = 'seedance-fast'

const MODEL_CAPABILITIES: Record<string, VideoModelCapability> = {
  kling: {
    id: 'kling',
    label: 'Kling',
    minOutputDuration: 5,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 10.5,
    referenceVideoSize: {
      maxFileSizeMb: 200,
      maxFramePixels: 2_086_876,
      description: '<=200MB, resolution <=2K; no documented video resolution lower bound',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.112,
    estimatedCostPerSecondUsdByResolution: {
      '720p': 0.112,
      '1080p': 0.14,
      '4k': 0.42,
    },
    supportedResolutions: ['720p', '1080p', '4k'],
    defaultResolution: '720p',
    provider: 'kling',
    providerModel: 'kling-v3-omni',
  },
  'seedance-fast': {
    id: 'seedance-fast',
    label: 'SeeDance 2.0 Fast',
    minOutputDuration: 4,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 15.5,
    referenceVideoSize: {
      maxFileSizeMb: 50,
      minWidth: 300,
      maxWidth: 6000,
      minHeight: 300,
      maxHeight: 6000,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
      minFramePixels: 409_600,
      maxFramePixels: 2_086_876,
      description: '<=50MB, width/height 300-6000px, aspect 0.4-2.5, frame pixels 409,600-2,086,876',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.161,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.074,
      '720p': 0.161,
    },
    supportedResolutions: ['480p', '720p'],
    defaultResolution: '720p',
    provider: 'seedance',
    providerModel: 'seedance-2.0-fast-reference-to-video',
  },
  seedance: {
    id: 'seedance',
    label: 'SeeDance 2.0',
    minOutputDuration: 4,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 15.5,
    referenceVideoSize: {
      maxFileSizeMb: 50,
      minWidth: 300,
      maxWidth: 6000,
      minHeight: 300,
      maxHeight: 6000,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
      minFramePixels: 409_600,
      maxFramePixels: 2_086_876,
      description: '<=50MB, width/height 300-6000px, aspect 0.4-2.5, frame pixels 409,600-2,086,876',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.199,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.092,
      '720p': 0.199,
      '1080p': 0.496,
    },
    supportedResolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    provider: 'seedance',
    providerModel: 'seedance-2.0-reference-to-video',
  },
  grok: {
    id: 'grok',
    label: 'Grok Video 1.5',
    minOutputDuration: 1,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 0,
    supportsVideoReference: false,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 10,
    estimatedCostPerSecondUsd: 0.14,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.08,
      '720p': 0.14,
    },
    estimatedInputCostUsdPerImage: 0.01,
    maxImageReferences: 1,
    supportedResolutions: ['480p', '720p'],
    defaultResolution: '720p',
    provider: 'grok',
    providerModel: 'grok-imagine-video-1.5',
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
    supportedResolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    provider: 'piapi',
  },
}

const GENERIC_VIDEO_MODEL: VideoModelCapability = {
  id: 'generic',
  label: 'Video model',
  minOutputDuration: 4,
  maxOutputDuration: 15,
  maxReferenceVideoDuration: 15.5,
  referenceVideoSize: {
    maxFileSizeMb: 50,
    minWidth: 300,
    maxWidth: 6000,
    minHeight: 300,
    maxHeight: 6000,
    minAspectRatio: 0.4,
    maxAspectRatio: 2.5,
    minFramePixels: 409_600,
    maxFramePixels: 2_086_876,
    description: '<=50MB, width/height 300-6000px, aspect 0.4-2.5, frame pixels 409,600-2,086,876',
  },
  supportsVideoReference: true,
  supportsBaseVideoEdit: false,
  longVideoChunkSeconds: 15,
}

export function normalizeVideoModelId(model?: string | null): string {
  if (!model) return DEFAULT_MODEL_ID
  const normalized = String(model).trim().toLowerCase()
  if (normalized === 'seedance2-fast' || normalized === 'seedance-2.0-fast' || normalized === 'seedance_fast') {
    return 'seedance-fast'
  }
  if (normalized === 'seedance2' || normalized === 'seedance-2.0' || normalized === 'seedance-standard') {
    return 'seedance'
  }
  return normalized
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

export function normalizeVideoResolution(
  model?: string | null,
  resolution?: VideoResolutionInput,
): VideoResolution {
  const capability = getVideoModelCapability(model)
  if (!resolution || resolution === 'auto') return capability.defaultResolution ?? '720p'
  return resolution
}

export function resolveVideoGenerationRoute(options: {
  model?: string | null
  resolution?: VideoResolutionInput
}): VideoGenerationRoute {
  const model = normalizeVideoModelId(options.model)
  const capability = getVideoModelCapability(model)
  const resolution = normalizeVideoResolution(model, options.resolution)
  const perSecond = capability.estimatedCostPerSecondUsdByResolution?.[resolution] ?? capability.estimatedCostPerSecondUsd
  const provider = capability.provider ?? model
  const providerMode =
    provider === 'kling'
      ? resolution === '4k'
        ? '4k'
        : resolution === '1080p'
          ? 'pro'
          : 'std'
      : undefined

  return {
    model,
    label: capability.label,
    provider,
    providerModel: capability.providerModel,
    providerMode,
    resolution,
    estimatedCostPerSecondUsd: perSecond,
    estimatedInputCostUsdPerImage: capability.estimatedInputCostUsdPerImage,
  }
}

export function validateVideoResolutionRequest(options: {
  model?: string | null
  resolution?: VideoResolutionInput
}): string | null {
  const capability = getVideoModelCapability(options.model)
  const resolution = normalizeVideoResolution(options.model, options.resolution)
  if (capability.supportedResolutions?.length && !capability.supportedResolutions.includes(resolution)) {
    return `${capability.label} does not support ${resolution}. Supported resolutions: ${capability.supportedResolutions.join(', ')}.`
  }
  return null
}

export function estimateVideoProviderCostUsd(options: {
  model?: string | null
  durationSec: number
  imageCount?: number
  resolution?: VideoResolutionInput
}): number | undefined {
  const capability = getVideoModelCapability(options.model)
  const perSecond = resolveVideoGenerationRoute({
    model: options.model,
    resolution: options.resolution,
  }).estimatedCostPerSecondUsd
  if (perSecond == null) return undefined
  const billableImages = capability.maxImageReferences != null
    ? Math.min(options.imageCount ?? 0, capability.maxImageReferences)
    : (options.imageCount ?? 0)
  return options.durationSec * perSecond + billableImages * (capability.estimatedInputCostUsdPerImage ?? 0)
}

export function estimateVideoCredits(options: {
  model?: string | null
  durationSec: number
  imageCount?: number
  resolution?: VideoResolutionInput
  markup?: number
}): number | undefined {
  const costUsd = estimateVideoProviderCostUsd(options)
  if (costUsd == null) return undefined
  return Math.ceil(costUsd * 100 * (options.markup ?? 2) - 1e-9)
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
  resolution?: VideoResolutionInput
  outputDuration?: number
  referenceVideoDuration?: number
  referenceVideoMetas?: VideoReferenceMeta[]
  hasVideoReference?: boolean
  imageReferenceCount?: number
}): string | null {
  const capability = getVideoModelCapability(options.model)
  const resolutionError = validateVideoResolutionRequest({
    model: options.model,
    resolution: options.resolution,
  })
  if (resolutionError) return resolutionError

  if (options.outputDuration != null && options.outputDuration < capability.minOutputDuration) {
    return `${capability.label} duration must be ${capability.minOutputDuration} seconds or more.`
  }

  if (options.outputDuration != null && options.outputDuration > capability.maxOutputDuration) {
    return `${capability.label} duration must be ${capability.maxOutputDuration} seconds or less.`
  }

  if (options.hasVideoReference && !capability.supportsVideoReference) {
    return `${capability.label} does not support reference videos. Choose a model with video-reference support, or use run_code runtime="node" for non-generative MP4 processing.`
  }

  if (
    options.imageReferenceCount != null &&
    capability.maxImageReferences != null &&
    options.imageReferenceCount > capability.maxImageReferences
  ) {
    return `${capability.label} supports at most ${capability.maxImageReferences} reference images per request.`
  }

  if (options.referenceVideoDuration != null && options.referenceVideoDuration > capability.maxReferenceVideoDuration) {
    return `${capability.label} reference video duration must be ${capability.maxReferenceVideoDuration.toFixed(1).replace(/\.0$/, '')} seconds or less. Read skills/video-ffmpeg-lab/SKILL.md, then use run_code runtime="node" with FFmpeg to split the source video first, submit one generation task per chunk, and concatenate the results.`
  }

  const sizeError = validateVideoReferenceSize(capability, options.referenceVideoMetas)
  if (sizeError) return sizeError

  return null
}

export function validateVideoReferenceSize(
  capability: VideoModelCapability,
  metas?: VideoReferenceMeta[] | null
): string | null {
  if (!metas?.length || !capability.referenceVideoSize) return null
  const size = capability.referenceVideoSize

  for (const meta of metas) {
    const width = Number(meta.width)
    const height = Number(meta.height)
    const hasDimensions = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0

    if (hasDimensions) {
      const pixels = width * height
      const aspect = width / height
      if (
        (size.minWidth != null && width < size.minWidth) ||
        (size.maxWidth != null && width > size.maxWidth) ||
        (size.minHeight != null && height < size.minHeight) ||
        (size.maxHeight != null && height > size.maxHeight) ||
        (size.minAspectRatio != null && aspect < size.minAspectRatio) ||
        (size.maxAspectRatio != null && aspect > size.maxAspectRatio) ||
        (size.minFramePixels != null && pixels < size.minFramePixels) ||
        (size.maxFramePixels != null && pixels > size.maxFramePixels)
      ) {
        return `${capability.label} reference video size ${width}x${height} (${pixels} px, aspect ${aspect.toFixed(2)}) is outside provider limits: ${size.description}. Use FFmpeg to resize/pad the video before submitting it to the model.`
      }
    }

    const fileSizeBytes = Number(meta.fileSizeBytes)
    if (
      size.maxFileSizeMb != null &&
      Number.isFinite(fileSizeBytes) &&
      fileSizeBytes > size.maxFileSizeMb * 1024 * 1024
    ) {
      return `${capability.label} reference video file is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Provider limit: ${size.description}.`
    }
  }

  return null
}
