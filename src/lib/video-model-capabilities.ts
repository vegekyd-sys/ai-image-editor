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
  freeImageReferences?: number
  estimatedInputCostUsdPerVideoSecond?: number
  estimatedInputCostUsdPerVideoSecondByResolution?: Partial<Record<VideoResolution, number>>
  maxImageReferences?: number
  maxVideoReferences?: number
  maxAudioReferences?: number
  maxTotalReferences?: number
  supportsVideoExtend?: boolean
  supportedResolutions?: VideoResolution[]
  defaultResolution?: VideoResolution
  supportedAspectRatios?: VideoAspectRatio[]
  estimatedCostPerSecondUsdByResolution?: Partial<Record<VideoResolution, number>>
  provider?: 'kling' | 'seedance' | 'grok' | 'google-omni' | 'minimax' | 'piapi'
  providerModel?: string
}

export type VideoResolution = '480p' | '720p' | '768p' | '1080p' | '2k' | '4k'
export type VideoResolutionInput = VideoResolution | 'auto' | null | undefined
export type VideoGenerationOperation = 'generate' | 'edit' | 'extend'
export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3'
export type VideoAspectRatioInput = VideoAspectRatio | 'auto' | null | undefined

export interface VideoGenerationRoute {
  model: string
  label: string
  provider: 'kling' | 'seedance' | 'grok' | 'google-omni' | 'minimax' | 'piapi' | string
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
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
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
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    provider: 'seedance',
    providerModel: 'seedance-2.0-fast-reference-to-video',
  },
  'seedance-mini': {
    id: 'seedance-mini',
    label: 'SeeDance 2.0 Mini',
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
    estimatedCostPerSecondUsd: 0.056,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.056,
      '720p': 0.12,
    },
    supportedResolutions: ['480p', '720p'],
    defaultResolution: '480p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    provider: 'seedance',
    providerModel: 'seedance-2.0-mini-reference-to-video',
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
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    provider: 'seedance',
    providerModel: 'seedance-2.0-reference-to-video',
  },
  'seedance-2.5': {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    minOutputDuration: 4,
    maxOutputDuration: 30,
    maxReferenceVideoDuration: 30,
    referenceVideoSize: {
      maxFileSizeMb: 200,
      minWidth: 300,
      maxWidth: 6000,
      minHeight: 300,
      maxHeight: 6000,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
      minFramePixels: 409_600,
      maxFramePixels: 8_295_044,
      description: '<=200MB, width/height 300-6000px, aspect 0.4-2.5, frame pixels 409,600-8,295,044, 24-60fps',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    supportsVideoExtend: true,
    longVideoChunkSeconds: 30,
    maxImageReferences: 30,
    maxVideoReferences: 10,
    maxAudioReferences: 10,
    maxTotalReferences: 50,
    // EvoLink's public rate card still says pricing is unverified. Use the
    // conservative reference-route rates measured from successful live tasks
    // on 2026-08-08; revisit when EvoLink publishes the final rate card.
    estimatedCostPerSecondUsd: 0.325,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.275,
      '720p': 0.325,
    },
    supportedResolutions: ['480p', '720p'],
    defaultResolution: '720p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    provider: 'seedance',
    providerModel: 'seedance-2.5-reference-to-video',
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
    defaultResolution: '480p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'],
    provider: 'grok',
    providerModel: 'grok-imagine-video-1.5',
  },
  'google-omni': {
    id: 'google-omni',
    label: 'Gemini Omni Flash',
    minOutputDuration: 3,
    maxOutputDuration: 10,
    maxReferenceVideoDuration: 10.5,
    referenceVideoSize: {
      maxFileSizeMb: 55,
      description: '<=55MB inline upload in Makaron; one video reference per request',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    longVideoChunkSeconds: 10,
    estimatedCostPerSecondUsd: 0.1,
    maxImageReferences: 6,
    supportedResolutions: ['720p'],
    defaultResolution: '720p',
    supportedAspectRatios: ['16:9', '9:16'],
    provider: 'google-omni',
    providerModel: 'gemini-omni-flash-preview',
  },
  'minimax-h3': {
    id: 'minimax-h3',
    label: 'MiniMax H3',
    minOutputDuration: 4,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 15,
    referenceVideoSize: {
      maxFileSizeMb: 50,
      minWidth: 256,
      maxWidth: 5760,
      minHeight: 256,
      maxHeight: 5760,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
      description: '<=50MB, width/height 256-5760px, aspect 0.4-2.5',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    longVideoChunkSeconds: 15,
    estimatedCostPerSecondUsd: 0.112,
    estimatedCostPerSecondUsdByResolution: {
      '768p': 0.07,
      '2k': 0.112,
    },
    // MiniMax bills the first five input images at no charge, then RMB 0.20
    // per image. Reference video is billed per input second at the selected
    // resolution's output rate; reference audio is free.
    estimatedInputCostUsdPerImage: 0.028,
    freeImageReferences: 5,
    estimatedInputCostUsdPerVideoSecondByResolution: {
      '768p': 0.07,
      '2k': 0.112,
    },
    maxImageReferences: 9,
    // The public H3 API currently exposes 2K only. The adapter understands
    // 768P for accounts enrolled in MiniMax's gated preview, but the product
    // selector must not advertise a resolution that ordinary keys reject.
    supportedResolutions: ['2k'],
    defaultResolution: '2k',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    provider: 'minimax',
    providerModel: 'MiniMax-H3',
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
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
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
  if (normalized === 'seedance2-mini' || normalized === 'seedance-2.0-mini' || normalized === 'seedance_mini' || normalized === 'mini') {
    return 'seedance-mini'
  }
  if (normalized === 'seedance2' || normalized === 'seedance-2.0' || normalized === 'seedance-standard') {
    return 'seedance'
  }
  if (normalized === 'minimax' || normalized === 'h3' || normalized === 'hailuo-h3' || normalized === 'minimax-h3') {
    return 'minimax-h3'
  }
  if (normalized === 'seedance25' || normalized === 'seedance_2_5' || normalized === 'seedance-2-5') {
    return 'seedance-2.5'
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

export function resolveAgentVideoSelection(options: {
  appModel?: string | null
  appResolution?: VideoResolutionInput
  appAuto?: boolean | null
  toolModel?: string | null
  toolResolution?: VideoResolutionInput
}): { model: string; resolution: VideoResolutionInput; locked: boolean } {
  const appModel = normalizeVideoModelId(options.appModel)
  const appResolution = options.appResolution ?? 'auto'
  const appAuto = options.appAuto ?? (appModel === DEFAULT_MODEL_ID && appResolution === 'auto')
  const locked = !appAuto

  return {
    model: locked ? appModel : normalizeVideoModelId(options.toolModel || appModel),
    resolution: locked ? appResolution : (options.toolResolution ?? appResolution),
    locked,
  }
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

function getSeedanceProviderBase(model?: string | null): string | undefined {
  const id = normalizeVideoModelId(model)
  if (id === 'seedance-fast') return 'seedance-2.0-fast'
  if (id === 'seedance-mini') return 'seedance-2.0-mini'
  if (id === 'seedance') return 'seedance-2.0'
  if (id === 'seedance-2.5') return 'seedance-2.5'
  return undefined
}

export function supportsNativeTextToVideo(model?: string | null): boolean {
  const id = normalizeVideoModelId(model)
  return getSeedanceProviderBase(id) != null || id === 'minimax-h3'
}

export function resolveVideoProviderModel(options: {
  model?: string | null
  resolution?: VideoResolutionInput
  imageReferenceCount?: number
  hasVideoReference?: boolean
  hasAudioReference?: boolean
  operation?: VideoGenerationOperation
}): string | undefined {
  const route = resolveVideoGenerationRoute({
    model: options.model,
    resolution: options.resolution,
  })
  const hasReferenceMedia =
    (options.imageReferenceCount ?? 0) > 0 ||
    options.hasVideoReference === true ||
    options.hasAudioReference === true

  if (route.model === 'seedance-2.5') {
    if (options.operation === 'edit') return 'seedance-2.5-video-edit'
    if (options.operation === 'extend') return 'seedance-2.5-video-extend'
    if (!hasReferenceMedia) return 'seedance-2.5-text-to-video'
    if (
      (options.imageReferenceCount ?? 0) >= 1 &&
      (options.imageReferenceCount ?? 0) <= 2 &&
      !options.hasVideoReference &&
      !options.hasAudioReference
    ) {
      return 'seedance-2.5-image-to-video'
    }
    return 'seedance-2.5-reference-to-video'
  }

  if (supportsNativeTextToVideo(route.model) && !hasReferenceMedia) {
    return `${getSeedanceProviderBase(route.model)}-text-to-video`
  }

  return route.providerModel
}

export function validateVideoResolutionRequest(options: {
  model?: string | null
  resolution?: VideoResolutionInput
}): string | null {
  const capability = getVideoModelCapability(options.model)
  const resolution = normalizeVideoResolution(options.model, options.resolution)
  if (
    normalizeVideoModelId(options.model) === 'minimax-h3' &&
    resolution === '768p' &&
    process.env.MINIMAX_H3_ENABLE_768P === 'true'
  ) {
    return null
  }
  if (capability.supportedResolutions?.length && !capability.supportedResolutions.includes(resolution)) {
    return `${capability.label} does not support ${resolution}. Supported resolutions: ${capability.supportedResolutions.join(', ')}.`
  }
  return null
}

export function validateVideoAspectRatioRequest(options: {
  model?: string | null
  aspectRatio?: VideoAspectRatioInput
}): string | null {
  if (!options.aspectRatio || options.aspectRatio === 'auto') return null
  const capability = getVideoModelCapability(options.model)
  if (capability.supportedAspectRatios?.length && !capability.supportedAspectRatios.includes(options.aspectRatio)) {
    return `${capability.label} does not support ${options.aspectRatio}. Supported aspect ratios: ${capability.supportedAspectRatios.join(', ')}.`
  }
  return null
}

export function resolveVideoProviderAspectRatio(
  model?: string | null,
  aspectRatio?: VideoAspectRatioInput,
): string | undefined {
  const route = resolveVideoGenerationRoute({ model })
  // xAI stretches the source image when image-to-video receives a forced
  // aspect_ratio. Grok in Makaron is single-image-to-video, so keep source AR.
  if (route.provider === 'grok') return undefined
  if (!aspectRatio || aspectRatio === 'auto') {
    return route.provider === 'seedance' ? 'adaptive' : undefined
  }
  return aspectRatio
}

const ASPECT_RATIO_VALUES: Record<VideoAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '21:9': 21 / 9,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
}

export function resolveClosestSupportedAspectRatio(
  model?: string | null,
  width?: number | null,
  height?: number | null,
): VideoAspectRatio | undefined {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined

  const supported = getVideoModelCapability(model).supportedAspectRatios
  if (!supported?.length) return undefined

  const target = w / h
  let best: VideoAspectRatio | undefined
  let bestDistance = Infinity
  for (const ratio of supported) {
    const value = ASPECT_RATIO_VALUES[ratio]
    if (!value) continue
    const distance = Math.abs(Math.log(target / value))
    if (distance < bestDistance) {
      best = ratio
      bestDistance = distance
    }
  }
  return best
}

export function estimateVideoProviderCostUsd(options: {
  model?: string | null
  durationSec: number
  imageCount?: number
  referenceVideoDurationSec?: number
  resolution?: VideoResolutionInput
  contentFilter?: boolean
}): number | undefined {
  const capability = getVideoModelCapability(options.model)
  const route = resolveVideoGenerationRoute({
    model: options.model,
    resolution: options.resolution,
  })
  const perSecond = route.estimatedCostPerSecondUsd
  if (perSecond == null) return undefined
  const acceptedImages = capability.maxImageReferences != null
    ? Math.min(options.imageCount ?? 0, capability.maxImageReferences)
    : (options.imageCount ?? 0)
  const billableImages = Math.max(0, acceptedImages - (capability.freeImageReferences ?? 0))
  const inputVideoPerSecond = capability.estimatedInputCostUsdPerVideoSecondByResolution?.[route.resolution]
    ?? capability.estimatedInputCostUsdPerVideoSecond
    ?? 0
  const standardCost = options.durationSec * perSecond
    + billableImages * (capability.estimatedInputCostUsdPerImage ?? 0)
    + Math.max(0, options.referenceVideoDurationSec ?? 0) * inputVideoPerSecond
  return normalizeVideoModelId(options.model) === 'seedance-2.5' && options.contentFilter === false
    ? standardCost * 1.1
    : standardCost
}

export function estimateVideoCredits(options: {
  model?: string | null
  durationSec: number
  imageCount?: number
  referenceVideoDurationSec?: number
  resolution?: VideoResolutionInput
  contentFilter?: boolean
  markup?: number
}): number | undefined {
  const costUsd = estimateVideoProviderCostUsd(options)
  if (costUsd == null) return undefined
  return Math.ceil(costUsd * 100 * (options.markup ?? 2) - 1e-9)
}

export function isFastVideoRenderModel(model?: string | null): boolean {
  const normalized = normalizeVideoModelId(model)
  return normalized === 'grok' || normalized === 'google-omni'
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
  aspectRatio?: VideoAspectRatioInput
  outputDuration?: number
  referenceVideoDuration?: number
  referenceVideoMetas?: VideoReferenceMeta[]
  hasVideoReference?: boolean
  imageReferenceCount?: number
  videoReferenceCount?: number
  audioReferenceCount?: number
  operation?: VideoGenerationOperation
}): string | null {
  const capability = getVideoModelCapability(options.model)
  const resolutionError = validateVideoResolutionRequest({
    model: options.model,
    resolution: options.resolution,
  })
  if (resolutionError) return resolutionError
  const aspectRatioError = validateVideoAspectRatioRequest({
    model: options.model,
    aspectRatio: options.aspectRatio,
  })
  if (aspectRatioError) return aspectRatioError

  if (options.operation === 'edit' && normalizeVideoModelId(options.model) === 'seedance-2.5' && options.outputDuration !== -1) {
    return 'Seedance 2.5 video edit requires duration=-1 so the output follows the input video.'
  }

  if (options.operation !== 'edit' && options.outputDuration != null && options.outputDuration !== -1 && options.outputDuration < capability.minOutputDuration) {
    return `${capability.label} duration must be ${capability.minOutputDuration} seconds or more.`
  }

  if (options.operation !== 'edit' && options.outputDuration != null && options.outputDuration > capability.maxOutputDuration) {
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

  if (
    options.videoReferenceCount != null &&
    capability.maxVideoReferences != null &&
    options.videoReferenceCount > capability.maxVideoReferences
  ) {
    return `${capability.label} supports at most ${capability.maxVideoReferences} reference videos per request.`
  }

  if (
    options.audioReferenceCount != null &&
    capability.maxAudioReferences != null &&
    options.audioReferenceCount > capability.maxAudioReferences
  ) {
    return `${capability.label} supports at most ${capability.maxAudioReferences} reference audio files per request.`
  }

  const totalReferences =
    (options.imageReferenceCount ?? 0) +
    (options.videoReferenceCount ?? 0) +
    (options.audioReferenceCount ?? 0)
  if (capability.maxTotalReferences != null && totalReferences > capability.maxTotalReferences) {
    return `${capability.label} supports at most ${capability.maxTotalReferences} total reference assets per request.`
  }

  if (options.operation === 'edit' && !capability.supportsBaseVideoEdit) {
    return `${capability.label} does not support typed video editing.`
  }

  if (options.operation === 'extend' && !capability.supportsVideoExtend) {
    return `${capability.label} does not support video extension.`
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
