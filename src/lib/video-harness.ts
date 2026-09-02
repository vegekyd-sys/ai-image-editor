/**
 * Video harness — validate Agent's generate_animation input before calling the API.
 * Returns null if OK, or an error string to send back to the Agent for retry.
 */

import { getVideoModelCapability, normalizeVideoModelId, validateVideoAspectRatioRequest, validateVideoResolutionRequest, type VideoAspectRatioInput, type VideoGenerationOperation, type VideoResolutionInput } from '@/lib/video-model-capabilities';
import { parseTotalDuration } from './kling';

function urlMatch(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

export function validateVideoScript(opts: {
  prompt: string
  imageCount: number
  availableMediaIndices?: number[]
  imageUrls?: string[]
  imageRefs?: string[]
  videoRefUrl?: string
  videoRefType?: string
  model?: string
  resolution?: VideoResolutionInput
  aspectRatio?: VideoAspectRatioInput
  motionControl?: boolean
  duration?: number
  operation?: VideoGenerationOperation
}): string | null {
  const { prompt, imageCount, videoRefUrl, videoRefType, model, resolution, aspectRatio, motionControl, duration } = opts
  const availableMediaIndices = opts.availableMediaIndices
    ?? Array.from({ length: imageCount }, (_, index) => index + 1)

  // Motion control: only need video_ref_url, skip image reference checks
  if (motionControl) {
    if (!videoRefUrl) {
      return 'Motion Control requires a reference video. Pass the video URL as video_ref_url.'
    }
    return null
  }

  const capability = getVideoModelCapability(model)
  const providerManagedEditDuration = opts.operation === 'edit' && normalizeVideoModelId(model) === 'seedance-2.5'
  const resolutionError = validateVideoResolutionRequest({ model, resolution })
  if (resolutionError) return resolutionError
  const aspectRatioError = validateVideoAspectRatioRequest({ model, aspectRatio })
  if (aspectRatioError) return aspectRatioError
  const parsedDuration = parseTotalDuration(prompt)
  if (parsedDuration != null && parsedDuration < capability.minOutputDuration) {
    return `A single ${capability.label} video generation script must be at least ${capability.minOutputDuration} seconds, but this script totals ${parsedDuration}s. Extend it to a compact ${capability.minOutputDuration}s script and set duration=${capability.minOutputDuration}; the video model cannot generate shorter clips.`
  }
  if (parsedDuration != null && parsedDuration > capability.maxOutputDuration) {
    return `A single video generation script can be at most ${capability.maxOutputDuration} seconds, but this script totals ${parsedDuration}s. Use long-video-director to split it into self-contained segments of ${capability.longVideoChunkSeconds}s or less, and do not submit one long script.`
  }
  if (!providerManagedEditDuration && duration != null && duration < capability.minOutputDuration) {
    return `${capability.label} video generation duration must be at least ${capability.minOutputDuration} seconds, but duration=${duration}. Use duration=${capability.minOutputDuration}; the video model cannot generate shorter clips.`
  }
  if (!providerManagedEditDuration && duration != null && duration > capability.maxOutputDuration) {
    return `${capability.label} video generation duration must be ${capability.maxOutputDuration} seconds or less, but duration=${duration}.`
  }
  if (
    !providerManagedEditDuration
    && duration != null
    && capability.supportedDurations?.length
    && !capability.supportedDurations.includes(duration)
  ) {
    return `${capability.label} video generation duration must be one of ${capability.supportedDurations.join(', ')} seconds, but duration=${duration}.`
  }

  // 1. Image reference check: prompt has images available but doesn't reference any
  // Skip when video_ref_url is provided (video editing doesn't require image references)
  const refs = [...new Set(
    Array.from(prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), m => Number(m[1]))
  )]

  if (refs.length === 0 && availableMediaIndices.length > 0 && !videoRefUrl) {
    const markers = availableMediaIndices.map(index => `<<<media_${index}>>>`).join(', ')
    return `Your script doesn't reference any media with <<<media_N>>> format, but ${availableMediaIndices.length} items are available. You MUST use ${markers} in your prompt to reference them. The video model needs these markers to know which image to use where.`
  }

  if (
    capability.maxImageReferences != null &&
    refs.length > capability.maxImageReferences
  ) {
    return `${capability.label} supports at most ${capability.maxImageReferences} reference image${capability.maxImageReferences === 1 ? '' : 's'} per request. Choose a model with multi-image support or rewrite the script to use fewer image references.`
  }

  // 2. Image index out of bounds
  for (const ref of refs) {
    if (ref < 1 || ref > imageCount || !availableMediaIndices.includes(ref)) {
      const available = availableMediaIndices.length
        ? availableMediaIndices.map(index => `<<<media_${index}>>>`).join(', ')
        : 'none'
      return `<<<media_${ref}>>> is referenced in your script but that timeline item has no usable media. Available media: ${available}. Fix the reference.`
    }
  }

  // 3. Video URL in prompt text but not passed as parameter
  if (!videoRefUrl) {
    const videoUrlInPrompt = prompt.match(/https?:\/\/\S+\.(?:mp4|mov|webm)/i)
    if (videoUrlInPrompt) {
      return `Your script contains a video URL in the text ("${videoUrlInPrompt[0].slice(0, 60)}..."), but you didn't pass it as the video_ref_url parameter. Reference videos must be passed as tool parameters, not embedded in the prompt. Set video_ref_url to the video URL and video_ref_type to "feature" (or "base" for video editing).`
    }
  }

  // 4. base mode requires a model that can edit the reference video as the base.
  if (videoRefUrl && videoRefType === 'base') {
    if (!capability.supportsBaseVideoEdit) {
      return `Video editing (base mode) is not supported by ${capability.label}. Choose a model with base video editing support, or use video_ref_type="feature" for style/motion reference.`
    }
  }

  // 5. image_refs contains URLs already in Media Index
  if (opts.imageRefs?.length && opts.imageUrls?.length) {
    const duplicates: string[] = [];
    for (const ref of opts.imageRefs) {
      const matchIdx = opts.imageUrls.findIndex(u => u && urlMatch(u, ref));
      if (matchIdx >= 0) {
        duplicates.push(`"${ref.slice(0, 80)}" is already <<<media_${matchIdx + 1}>>>`);
      }
    }
    if (duplicates.length > 0) {
      return `image_refs contains URLs that are already in Media Index — do NOT pass them via image_refs. Use <<<media_N>>> directly in your script instead.\n\nDuplicates found:\n${duplicates.join('\n')}\n\nFix: Remove these from image_refs and reference them with <<<media_N>>> in your script. image_refs is ONLY for URLs NOT in Media Index (workspace files, skill assets).`;
    }
  }

  return null
}
