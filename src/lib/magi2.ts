import { getVideoModelCapability } from './video-model-capabilities'

export function isMagi2MediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return raw.length <= 8192 && url.protocol === 'https:' && !url.username && !url.password && !raw.includes('#')
  } catch {
    return false
  }
}

/** Preserve timeline marker identity while compacting the selected images. */
export function prepareMagi2References(prompt: string, images: string[], videos: string[], audioCount: number, explicitVideo: boolean) {
  const selectedImages: string[] = []
  const mapped = new Map<number, string>()
  let nextTimelineVideo = explicitVideo ? 1 : 0
  const text = prompt.replace(/<<<(?:image|media)_(\d+)>>>/gi, (_marker, rawIndex) => {
    const index = Number(rawIndex)
    const existing = mapped.get(index)
    if (existing) return existing
    const url = images[index - 1]
    if (index < 1) throw new Error('MAGI-2 media indices start at 1.')
    if (url) {
      const label = `Image ${selectedImages.push(url)}`
      mapped.set(index, label)
      return label
    }
    if (index <= images.length && nextTimelineVideo < videos.length) {
      const label = `Video ${++nextTimelineVideo}`
      mapped.set(index, label)
      return label
    }
    throw new Error(`MAGI-2 media reference ${index} has no corresponding input.`)
  }).replace(/<<<(video|audio)_(\d+)>>>|@audio(\d+)/gi, (_marker, type, number, audioNumber) => {
    const index = Number(number ?? audioNumber)
    if (type?.toLowerCase() !== 'video') {
      if (index < 1 || index > audioCount) throw new Error(`MAGI-2 audio reference ${index} has no corresponding input.`)
      return `Audio ${index}`
    }
    if (index < 1 || index > videos.length) throw new Error(`MAGI-2 video reference ${index} has no corresponding input.`)
    return `Video ${index}`
  })
  // Standalone callers can supply an ordered image list with an ordinary
  // prompt (or no prompt on an image/reference route).
  return { prompt: text, images: mapped.size ? selectedImages : images.filter(Boolean) }
}

export function buildMagi2Payload(input: {
  model: string
  prompt: string
  images: string[]
  videoUrls?: string[]
  audioUrls?: string[]
  duration?: number
  quality?: string
  aspectRatio?: string
  generateAudio?: boolean
  seed?: number
}) {
  const {
    model, images, videoUrls = [], audioUrls = [], duration = 5, quality = '1080p',
    aspectRatio = '16:9', generateAudio = true, seed,
  } = input
  const prompt = input.prompt.trim()
  const capability = getVideoModelCapability('magi-2')
  if (!Number.isInteger(duration) || duration < capability.minOutputDuration || duration > capability.maxOutputDuration) {
    throw new Error('MAGI-2 requires a whole-second output duration between 4 and 30 seconds.')
  }
  if (quality !== '1080p' || !capability.supportedAspectRatios?.some(ratio => ratio === aspectRatio)) {
    throw new Error('MAGI-2 requires 1080p and a supported fixed aspect ratio.')
  }
  if (Array.from(prompt).length > 15_000 || (!prompt && model === 'magi-2-text-to-video')) {
    throw new Error('MAGI-2 text prompts must contain 1–15,000 Unicode characters.')
  }
  if (seed != null && (!Number.isSafeInteger(seed) || seed < 0 || seed > 4_294_967_295)) {
    throw new Error('MAGI-2 seed must be an integer between 0 and 4294967295.')
  }
  const inputs = [...images, ...videoUrls, ...audioUrls]
  if (inputs.some(url => !isMagi2MediaUrl(url))) throw new Error('MAGI-2 references require public HTTPS download URLs.')
  switch (model) {
    case 'magi-2-text-to-video':
      if (inputs.length) throw new Error('MAGI-2 text-to-video accepts only text.')
      break
    case 'magi-2-image-to-video':
      if (images.length < 1 || images.length > 2 || videoUrls.length || audioUrls.length) {
        throw new Error('MAGI-2 first/last frame mode accepts one or two images.')
      }
      break
    case 'magi-2-reference-to-video':
      if (!inputs.length || images.length > 10 || videoUrls.length > 5 || audioUrls.length > 5) {
        throw new Error('MAGI-2 reference-to-video needs at least one input and accepts up to 10 images, 5 videos and 5 audio clips.')
      }
      break
    default:
      throw new Error('Unknown EvoLink MAGI-2 route.')
  }
  return {
    model, duration, quality, aspect_ratio: aspectRatio, generate_audio: generateAudio,
    ...(prompt ? { prompt } : {}),
    ...(images.length ? { image_urls: images } : {}),
    ...(videoUrls.length ? { video_urls: videoUrls } : {}),
    ...(audioUrls.length ? { audio_urls: audioUrls } : {}),
    ...(seed != null ? { seed } : {}),
  }
}
