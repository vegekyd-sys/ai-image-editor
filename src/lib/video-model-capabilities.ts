export interface VideoModelCapability {
  id: string
  label: string
  minOutputDuration: number
  maxOutputDuration: number
  maxReferenceVideoDuration: number
  maxCombinedReferenceAndOutputDuration?: number
  referenceVideoDurationTolerance?: number
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
  /**
   * Image inputs are feature references by default across Makaron. Models that
   * do not accept images must say `none`; first-frame/image-to-video is never a
   * valid default and requires a separate, explicit product contract.
   */
  defaultImageWorkflow: 'reference-to-video' | 'none'
  supportsExplicitImageToVideo?: boolean
  supportsVideoExtend?: boolean
  supportedResolutions?: VideoResolution[]
  defaultResolution?: VideoResolution
  supportedAspectRatios?: VideoAspectRatio[]
  estimatedCostPerSecondUsdByResolution?: Partial<Record<VideoResolution, number>>
  provider?: 'kling' | 'seedance' | 'mulerouter' | 'grok' | 'google-omni' | 'minimax' | 'fal-sync' | 'piapi'
  providerModel?: string
}

export type VideoResolution = '360p' | '480p' | '720p' | '768p' | '1080p' | '2k' | '4k'
export type VideoResolutionInput = VideoResolution | 'auto' | null | undefined
export type VideoGenerationOperation = 'generate' | 'edit' | 'extend'
export type VideoImageWorkflow = 'reference-to-video' | 'image-to-video'
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
    defaultImageWorkflow: 'reference-to-video',
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
    defaultImageWorkflow: 'reference-to-video',
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
    defaultImageWorkflow: 'reference-to-video',
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
    defaultImageWorkflow: 'reference-to-video',
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
    referenceVideoDurationTolerance: 0.5,
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
    defaultImageWorkflow: 'reference-to-video',
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
  'wan-3.0': {
    id: 'wan-3.0',
    label: 'Wan 3.0 Standard',
    minOutputDuration: 2,
    maxOutputDuration: 30,
    maxReferenceVideoDuration: 15,
    maxCombinedReferenceAndOutputDuration: 30,
    referenceVideoDurationTolerance: 0.5,
    referenceVideoSize: {
      maxFileSizeMb: 100,
      minWidth: 240,
      maxWidth: 4096,
      minHeight: 240,
      maxHeight: 4096,
      minAspectRatio: 0.125,
      maxAspectRatio: 8,
      description: '<=100MB MP4/MOV, side 240-4096px, aspect <=8:1, each 1-15s and <=15s total',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    defaultImageWorkflow: 'reference-to-video',
    supportsVideoExtend: false,
    longVideoChunkSeconds: 30,
    maxImageReferences: 10,
    maxVideoReferences: 5,
    maxAudioReferences: 5,
    maxTotalReferences: 20,
    // MuleRouter W3.0 pricing, verified 2026-09-01. Audio is included at the
    // same rate; references do not add a separate input charge.
    estimatedCostPerSecondUsd: 0.2,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.05,
      '720p': 0.1,
      '1080p': 0.2,
      '2k': 0.2,
      '4k': 0.23,
    },
    supportedResolutions: ['480p', '720p', '1080p', '2k', '4k'],
    defaultResolution: '1080p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    provider: 'mulerouter',
    providerModel: 'carrothub/w3.0-video',
  },
  'wan-3.0-prime': {
    id: 'wan-3.0-prime',
    label: 'Wan 3.0 Prime',
    minOutputDuration: 2,
    maxOutputDuration: 30,
    maxReferenceVideoDuration: 15,
    maxCombinedReferenceAndOutputDuration: 30,
    referenceVideoDurationTolerance: 0.5,
    referenceVideoSize: {
      maxFileSizeMb: 100,
      minWidth: 240,
      maxWidth: 4096,
      minHeight: 240,
      maxHeight: 4096,
      minAspectRatio: 0.125,
      maxAspectRatio: 8,
      description: '<=100MB MP4/MOV, side 240-4096px, aspect <=8:1, each 1-15s and <=15s total',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: false,
    defaultImageWorkflow: 'reference-to-video',
    supportsVideoExtend: false,
    longVideoChunkSeconds: 30,
    maxImageReferences: 10,
    maxVideoReferences: 5,
    maxAudioReferences: 5,
    maxTotalReferences: 20,
    // MuleRouter W3.0 Prime list pricing, verified 2026-09-02. Prime uses
    // the same reference contract as Standard with a faster generation tier.
    estimatedCostPerSecondUsd: 0.28,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.068,
      '720p': 0.14,
      '1080p': 0.28,
      '2k': 0.28,
      '4k': 0.31,
    },
    supportedResolutions: ['480p', '720p', '1080p', '2k', '4k'],
    defaultResolution: '1080p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    provider: 'mulerouter',
    providerModel: 'carrothub/w3.0-video-prime',
  },
  'sync-lipsync-v3': {
    id: 'sync-lipsync-v3',
    label: 'Sync Lipsync v3',
    minOutputDuration: 2,
    maxOutputDuration: 60,
    maxReferenceVideoDuration: 60,
    referenceVideoSize: {
      maxFileSizeMb: 200,
      description: '<=200MB; output preserves the source frame size and aspect ratio',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    defaultImageWorkflow: 'none',
    longVideoChunkSeconds: 60,
    estimatedCostPerSecondUsd: 8 / 60,
    maxImageReferences: 0,
    maxVideoReferences: 1,
    maxAudioReferences: 1,
    maxTotalReferences: 2,
    supportedResolutions: ['720p', '1080p', '2k', '4k'],
    defaultResolution: '1080p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3'],
    provider: 'fal-sync',
    providerModel: 'fal-ai/sync-lipsync/v3',
  },
  grok: {
    id: 'grok',
    label: 'Grok Imagine Video',
    minOutputDuration: 1,
    maxOutputDuration: 15,
    maxReferenceVideoDuration: 15,
    referenceVideoSize: {
      description: 'MP4 with an MP4-supported codec; edit input <=8.7s, extension input 2-15s',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    defaultImageWorkflow: 'reference-to-video',
    supportsVideoExtend: true,
    longVideoChunkSeconds: 10,
    estimatedCostPerSecondUsd: 0.14,
    estimatedCostPerSecondUsdByResolution: {
      '480p': 0.08,
      '720p': 0.14,
      '1080p': 0.25,
    },
    estimatedInputCostUsdPerImage: 0.01,
    maxImageReferences: 7,
    maxVideoReferences: 1,
    supportedResolutions: ['480p', '720p', '1080p'],
    defaultResolution: '480p',
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'],
    provider: 'grok',
    providerModel: 'grok-imagine-video-1.5',
  },
  'google-omni': {
    id: 'google-omni',
    label: 'Gemini Omni 1.1 Flash',
    minOutputDuration: 3,
    maxOutputDuration: 10,
    maxReferenceVideoDuration: 10.5,
    referenceVideoSize: {
      maxFileSizeMb: 55,
      description: '<=55MB inline upload in Makaron; one video reference per request',
    },
    supportsVideoReference: true,
    supportsBaseVideoEdit: true,
    defaultImageWorkflow: 'reference-to-video',
    supportsVideoExtend: true,
    longVideoChunkSeconds: 10,
    // Verified from live 1.1 usage metadata on 2026-08-29 at Google's
    // $17.50 / 1M video-output-token rate.
    estimatedCostPerSecondUsd: 0.10136,
    estimatedCostPerSecondUsdByResolution: {
      '360p': 0.0337925, // 1,931 tokens/s
      '720p': 0.10136, // 5,792 tokens/s
      '1080p': 0.15204, // 8,688 tokens/s
      '4k': 0.30408, // 17,376 tokens/s
    },
    // A live 720p extension probe consumed 27,840 input-video tokens for a
    // 5.013-second source. Google bills those tokens at $1.50 / 1M.
    estimatedInputCostUsdPerVideoSecond: 0.0083303411,
    maxImageReferences: 6,
    maxVideoReferences: 1,
    supportedResolutions: ['360p', '720p', '1080p', '4k'],
    defaultResolution: '720p',
    supportedAspectRatios: ['16:9', '9:16'],
    provider: 'google-omni',
    providerModel: 'gemini-omni-1.1-flash',
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
    defaultImageWorkflow: 'reference-to-video',
    longVideoChunkSeconds: 15,
    // MiniMax list price (2026-08-12): RMB 0.50/s at 768P and RMB 0.80/s at 2K.
    // These USD estimates follow Makaron's existing RMB 1 ~= USD 0.14 billing
    // convention; estimateVideoCredits() applies the product's 2x markup.
    estimatedCostPerSecondUsd: 0.07,
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
    supportedResolutions: ['768p', '2k'],
    defaultResolution: '768p',
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
    defaultImageWorkflow: 'reference-to-video',
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
  defaultImageWorkflow: 'reference-to-video',
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
  if (normalized === 'wan3' || normalized === 'wan30' || normalized === 'wan3.0' || normalized === 'wan-3' || normalized === 'wan_3_0') {
    return 'wan-3.0'
  }
  if (normalized === 'wan3-prime' || normalized === 'wan30-prime' || normalized === 'wan3.0-prime' || normalized === 'wan-3-prime' || normalized === 'wan_3_0_prime' || normalized === 'w3.0-video-prime' || normalized === 'w3.0-video-prime-pro' || normalized === 'wan-3.0-prime-pro' || normalized === 'prime') {
    return 'wan-3.0-prime'
  }
  if (normalized === 'wan3-pro' || normalized === 'wan30-pro' || normalized === 'wan3.0-pro' || normalized === 'wan-3-pro' || normalized === 'wan_3_0_pro' || normalized === 'berry-1.0-pro' || normalized === 'w3.0-video-pro') {
    return 'wan-3.0'
  }
  if (normalized === 'sync3' || normalized === 'sync-v3' || normalized === 'lipsync' || normalized === 'lip-sync') {
    return 'sync-lipsync-v3'
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

/**
 * Resolve how image inputs are interpreted before selecting a provider.
 *
 * One image is still a feature reference. Image count must never implicitly
 * switch generation into a first-frame/image-to-video route. A future model
 * may expose that workflow only through both an explicit request and an
 * explicit capability opt-in.
 */
export function resolveVideoImageWorkflow(options: {
  model?: string | null
  imageReferenceCount?: number
  requestedWorkflow?: VideoImageWorkflow
}): VideoImageWorkflow | undefined {
  if ((options.imageReferenceCount ?? 0) <= 0) return undefined

  const capability = getVideoModelCapability(options.model)
  if (capability.defaultImageWorkflow === 'none') {
    throw new Error(`${capability.label} does not support image references.`)
  }
  if (options.requestedWorkflow === 'image-to-video' && !capability.supportsExplicitImageToVideo) {
    throw new Error(
      `${capability.label} does not expose an explicit image-to-video/first-frame workflow. Images are feature references by default.`,
    )
  }
  return options.requestedWorkflow ?? capability.defaultImageWorkflow
}

export function validateVideoImageWorkflowRequest(options: {
  model?: string | null
  imageReferenceCount?: number
  requestedWorkflow?: VideoImageWorkflow
}): string | null {
  try {
    resolveVideoImageWorkflow(options)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
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
  const providerModel = model === 'wan-3.0' && (resolution === '2k' || resolution === '4k')
    ? 'carrothub/w3.0-video-pro'
    : model === 'wan-3.0-prime' && (resolution === '2k' || resolution === '4k')
      ? 'carrothub/w3.0-video-prime-pro'
      : capability.providerModel
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
    providerModel,
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
  return getSeedanceProviderBase(id) != null || id === 'wan-3.0' || id === 'wan-3.0-prime' || id === 'minimax-h3' || id === 'google-omni' || id === 'grok'
}

export function resolveVideoProviderModel(options: {
  model?: string | null
  resolution?: VideoResolutionInput
  aspectRatio?: VideoAspectRatioInput
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

  if (route.model === 'grok') {
    if (options.operation === 'edit' || options.operation === 'extend') return 'grok-imagine-video'
    return 'grok-imagine-video-1.5'
  }

  if (route.model === 'seedance-2.5') {
    if (options.operation === 'edit') return 'seedance-2.5-video-edit'
    if (options.operation === 'extend') return 'seedance-2.5-video-extend'
    if (!hasReferenceMedia) return 'seedance-2.5-text-to-video'
    return 'seedance-2.5-reference-to-video'
  }

  if (route.model === 'wan-3.0' || route.model === 'wan-3.0-prime') {
    return route.providerModel
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
  if (route.provider === 'fal-sync') return undefined
  if (!aspectRatio || aspectRatio === 'auto') {
    return route.provider === 'seedance' || route.provider === 'mulerouter' ? 'adaptive' : undefined
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
  operation?: VideoGenerationOperation
  contentFilter?: boolean
}): number | undefined {
  const capability = getVideoModelCapability(options.model)
  const route = resolveVideoGenerationRoute({
    model: options.model,
    resolution: options.resolution,
  })
  const normalizedModel = normalizeVideoModelId(options.model)
  const isGrokVideoInput = normalizedModel === 'grok' && (options.operation === 'edit' || options.operation === 'extend')
  // xAI exposes editing/extension through the base grok-imagine-video model,
  // whose output is capped at 720p ($0.07/s) and whose source video costs
  // $0.01/s. Generation/reference modes use the 1.5 resolution table above.
  const perSecond = isGrokVideoInput ? 0.07 : route.estimatedCostPerSecondUsd
  if (perSecond == null) return undefined
  const acceptedImages = capability.maxImageReferences != null
    ? Math.min(options.imageCount ?? 0, capability.maxImageReferences)
    : (options.imageCount ?? 0)
  const billableImages = Math.max(0, acceptedImages - (capability.freeImageReferences ?? 0))
  const inputVideoPerSecond = isGrokVideoInput
    ? 0.01
    : capability.estimatedInputCostUsdPerVideoSecondByResolution?.[route.resolution]
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
  operation?: VideoGenerationOperation
  contentFilter?: boolean
  markup?: number
}): number | undefined {
  const costUsd = estimateVideoProviderCostUsd(options)
  if (costUsd == null) return undefined
  return Math.ceil(costUsd * 100 * (options.markup ?? 2) - 1e-9)
}

export function getRequiredVideoCredits(
  options: Parameters<typeof estimateVideoCredits>[0],
): number {
  const credits = estimateVideoCredits(options)
  if (credits == null) {
    const route = resolveVideoGenerationRoute({
      model: options.model,
      resolution: options.resolution,
    })
    throw new Error(
      `Video pricing is not configured for ${route.label} at ${route.resolution}. Generation is blocked to prevent incorrect billing.`,
    )
  }
  return credits
}

export function isFastVideoRenderModel(model?: string | null): boolean {
  const normalized = normalizeVideoModelId(model)
  return normalized === 'grok' || normalized === 'google-omni'
}

export function resolveVideoOutputDuration(options: {
  requestedDuration?: number
  referenceVideoDuration?: number
  model?: string | null
  operation?: VideoGenerationOperation
}): number | undefined {
  const capability = getVideoModelCapability(options.model)
  const normalizedModel = normalizeVideoModelId(options.model)
  if (normalizedModel === 'grok' && options.operation === 'edit') {
    return options.referenceVideoDuration
  }
  if (normalizedModel === 'grok' && options.operation === 'extend') {
    return options.requestedDuration ?? 6
  }
  if (options.requestedDuration != null) return options.requestedDuration
  if (options.operation === 'extend' && normalizeVideoModelId(options.model) === 'google-omni') {
    return capability.maxOutputDuration
  }
  if (options.referenceVideoDuration != null) {
    return Math.min(capability.maxOutputDuration, Math.round(options.referenceVideoDuration))
  }
  return undefined
}

/**
 * Duration of the persisted asset, which can differ from the newly generated
 * segment. Omni returns the uploaded source and its continuation as one MP4.
 */
export function resolvePersistedVideoDuration(options: {
  model?: string | null
  operation?: VideoGenerationOperation
  outputDuration?: number
  referenceVideoDuration?: number
}): number | undefined {
  if (options.outputDuration == null) return undefined
  if (
    (normalizeVideoModelId(options.model) === 'google-omni' || normalizeVideoModelId(options.model) === 'grok')
    && options.operation === 'extend'
    && options.referenceVideoDuration != null
  ) {
    return normalizeVideoModelId(options.model) === 'google-omni'
      ? Math.min(40, options.referenceVideoDuration + options.outputDuration)
      : options.referenceVideoDuration + options.outputDuration
  }
  return options.outputDuration
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
  voiceReferenceCount?: number
  imageWorkflow?: VideoImageWorkflow
  operation?: VideoGenerationOperation
}): string | null {
  const capability = getVideoModelCapability(options.model)
  const normalizedModel = normalizeVideoModelId(options.model)
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
  const imageWorkflowError = validateVideoImageWorkflowRequest({
    model: options.model,
    imageReferenceCount: options.imageReferenceCount,
    requestedWorkflow: options.imageWorkflow,
  })
  if (imageWorkflowError) return imageWorkflowError

  if (normalizedModel === 'grok') {
    const operation = options.operation || 'generate'
    if (options.hasVideoReference && operation === 'generate') {
      return 'Grok video input requires video_operation="edit" or "extend". Use edit to modify the existing clip, or extend to continue from its ending.'
    }
    if (operation === 'edit') {
      if (options.referenceVideoDuration != null && options.referenceVideoDuration > 8.7) {
        return 'Grok video editing accepts one source MP4 up to 8.7 seconds. Split the source first, edit each segment, then reassemble it.'
      }
      if ((options.imageReferenceCount ?? 0) > 0 || (options.audioReferenceCount ?? 0) > 0 || (options.voiceReferenceCount ?? 0) > 0) {
        return 'Grok video editing cannot be combined with image or audio references in the same request.'
      }
    }
    if (operation === 'extend') {
      if (options.outputDuration != null && (options.outputDuration < 2 || options.outputDuration > 10)) {
        return 'Grok video extension duration must be between 2 and 10 seconds.'
      }
      if (options.referenceVideoDuration != null && (options.referenceVideoDuration < 2 || options.referenceVideoDuration > 15)) {
        return 'Grok video extension accepts one source MP4 between 2 and 15 seconds.'
      }
      if ((options.imageReferenceCount ?? 0) > 0 || (options.audioReferenceCount ?? 0) > 0 || (options.voiceReferenceCount ?? 0) > 0) {
        return 'Grok video extension cannot be combined with image or audio references in the same request.'
      }
    }
    if (
      operation === 'generate'
      && ((options.imageReferenceCount ?? 0) > 0 || (options.voiceReferenceCount ?? 0) > 0)
      && normalizeVideoResolution(options.model, options.resolution) === '1080p'
    ) {
      return 'Grok reference-to-video is capped at 720p. Native 1080p is available only for text-to-video without image or voice references.'
    }
  }

  if ((normalizedModel === 'wan-3.0' || normalizedModel === 'wan-3.0-prime') && options.operation && options.operation !== 'generate') {
    return 'Wan 3.0 supports generation with multimodal references, but does not expose typed video edit or extend operations. Use video_operation="generate" with feature references.'
  }

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

  const acceptedReferenceDuration = capability.maxReferenceVideoDuration + (capability.referenceVideoDurationTolerance ?? 0)
  if (options.referenceVideoDuration != null && options.referenceVideoDuration > acceptedReferenceDuration) {
    return `${capability.label} reference video duration must be ${capability.maxReferenceVideoDuration.toFixed(1).replace(/\.0$/, '')} seconds or less. Read skills/video-ffmpeg-lab/SKILL.md, then use run_code runtime="node" with FFmpeg to split the source video first, submit one generation task per chunk, and concatenate the results.`
  }

  const combinedDurationLimit = capability.maxCombinedReferenceAndOutputDuration
  if (
    combinedDurationLimit != null
    && options.hasVideoReference
    && options.referenceVideoDuration != null
    && options.outputDuration != null
    && options.outputDuration !== -1
  ) {
    const combinedDuration = options.referenceVideoDuration + options.outputDuration
    if (combinedDuration > combinedDurationLimit) {
      const formatSeconds = (value: number) => Number(value.toFixed(2)).toString()
      const maximumWholeSecondOutput = Math.floor(combinedDurationLimit - options.referenceVideoDuration + Number.EPSILON)
      const repair = maximumWholeSecondOutput >= capability.minOutputDuration
        ? `Set duration=${maximumWholeSecondOutput} or shorter, or trim the reference video before submitting.`
        : `Trim the reference video before submitting so at least ${capability.minOutputDuration} seconds remain for the output.`
      return `${capability.label} reference-plus-output duration must be ${formatSeconds(combinedDurationLimit)} seconds or less. Current request: ${formatSeconds(options.referenceVideoDuration)}s reference + ${formatSeconds(options.outputDuration)}s output = ${formatSeconds(combinedDuration)}s. ${repair}`
    }
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
