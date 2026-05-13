/**
 * Video harness — validate Agent's generate_animation input before calling the API.
 * Returns null if OK, or an error string to send back to the Agent for retry.
 */

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
  imageUrls?: string[]
  imageRefs?: string[]
  videoRefUrl?: string
  videoRefType?: string
  model?: string
  motionControl?: boolean
}): string | null {
  const { prompt, imageCount, videoRefUrl, videoRefType, model, motionControl } = opts

  // Motion control: only need video_ref_url, skip image reference checks
  if (motionControl) {
    if (!videoRefUrl) {
      return 'Motion Control requires a reference video. Pass the video URL as video_ref_url.'
    }
    return null
  }

  // 1. Image reference check: prompt has images available but doesn't reference any
  // Skip when video_ref_url is provided (video editing doesn't require image references)
  const refs = [...new Set(
    Array.from(prompt.matchAll(/<<<image_(\d+)>>>/g), m => Number(m[1]))
  )]

  if (refs.length === 0 && imageCount > 0 && !videoRefUrl) {
    return `Your script doesn't reference any images with <<<image_N>>> format, but ${imageCount} images are available. You MUST use <<<image_1>>>${imageCount > 1 ? ` through <<<image_${imageCount}>>>` : ''} in your prompt to reference them. The video model needs these markers to know which image to use where.`
  }

  // 2. Image index out of bounds
  for (const ref of refs) {
    if (ref < 1 || ref > imageCount) {
      return `<<<image_${ref}>>> is referenced in your script but only ${imageCount} image${imageCount !== 1 ? 's are' : ' is'} available (<<<image_1>>>${imageCount > 1 ? ` to <<<image_${imageCount}>>>` : ''}). Fix the reference.`
    }
  }

  // 3. Video URL in prompt text but not passed as parameter
  if (!videoRefUrl) {
    const videoUrlInPrompt = prompt.match(/https?:\/\/\S+\.(?:mp4|mov|webm)/i)
    if (videoUrlInPrompt) {
      return `Your script contains a video URL in the text ("${videoUrlInPrompt[0].slice(0, 60)}..."), but you didn't pass it as the video_ref_url parameter. Reference videos must be passed as tool parameters, not embedded in the prompt. Set video_ref_url to the video URL and video_ref_type to "feature" (or "base" for video editing).`
    }
  }

  // 4. base mode only on Kling
  if (videoRefUrl && videoRefType === 'base' && model === 'seedance') {
    return 'Video editing (base mode) is only supported by Kling. Either switch to model="kling" or use video_ref_type="feature" for style/motion reference.'
  }

  // 5. image_refs contains URLs already in Image Index
  if (opts.imageRefs?.length && opts.imageUrls?.length) {
    const duplicates: string[] = [];
    for (const ref of opts.imageRefs) {
      const matchIdx = opts.imageUrls.findIndex(u => u && urlMatch(u, ref));
      if (matchIdx >= 0) {
        duplicates.push(`"${ref.slice(0, 80)}" is already <<<image_${matchIdx + 1}>>>`);
      }
    }
    if (duplicates.length > 0) {
      return `image_refs contains URLs that are already in Image Index — do NOT pass them via image_refs. Use <<<image_N>>> directly in your script instead.\n\nDuplicates found:\n${duplicates.join('\n')}\n\nFix: Remove these from image_refs and reference them with <<<image_N>>> in your script. image_refs is ONLY for URLs NOT in Image Index (workspace files, skill assets).`;
    }
  }

  return null
}
