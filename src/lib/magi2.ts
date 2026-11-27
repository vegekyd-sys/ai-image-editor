import { getVideoModelCapability, validateVideoAspectRatioRequest } from './video-model-capabilities'

export function validateMagi2Prompt(prompt: unknown): string | null {
  if (typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt.trim()).length > 15_000) {
    return 'MAGI-2 requires a non-blank prompt of at most 15,000 characters for every mode.'
  }
  return null
}

export function isMagi2MediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return raw.length <= 8192 && url.protocol === 'https:' && !url.username && !url.password && !raw.includes('#')
  } catch {
    return false
  }
}

/** Preserve timeline marker identity while compacting the selected images. */
export function prepareMagi2References(prompt: string, images: string[], videos: string[], audioCount: number, explicitVideo: boolean, orderedFrames = false) {
  const selectedImages: string[] = []
  const mapped = new Map<number, string>()
  if (orderedFrames) {
    images.forEach((url, index) => {
      if (url) mapped.set(index + 1, `Image ${selectedImages.push(url)}`)
    })
  }
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
}) {
  const {
    model, images, videoUrls = [], audioUrls = [], duration = 5, quality = '1080p',
    generateAudio = true,
  } = input
  const isFrameMode = model === 'magi-2-image-to-video'
  const aspectRatio = input.aspectRatio ?? (isFrameMode ? 'auto' : '16:9')
  const capability = getVideoModelCapability('magi-2')
  if (!Number.isInteger(duration) || duration < capability.minOutputDuration || duration > capability.maxOutputDuration) {
    throw new Error('MAGI-2 requires a whole-second output duration between 4 and 30 seconds.')
  }
  if (quality !== '1080p') throw new Error('MAGI-2 supports 1080p only.')
  const ratioError = validateVideoAspectRatioRequest({ model: 'magi-2', aspectRatio, imageWorkflow: isFrameMode ? 'image-to-video' : undefined })
  if (ratioError) throw new Error(ratioError)
  const promptError = validateMagi2Prompt(input.prompt)
  if (promptError) throw new Error(promptError)
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
    model, duration, quality, aspect_ratio: aspectRatio === 'auto' && !isFrameMode ? '16:9' : aspectRatio,
    generate_audio: generateAudio, prompt: input.prompt.trim(),
    ...(images.length ? { image_urls: images } : {}),
    ...(videoUrls.length ? { video_urls: videoUrls } : {}),
    ...(audioUrls.length ? { audio_urls: audioUrls } : {}),
  }
}
