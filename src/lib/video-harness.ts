/**
 * Video harness — validate Agent's generate_animation input before calling the API.
 * Returns null if OK, or an error string to send back to the Agent for retry.
 */

export function validateVideoScript(opts: {
  prompt: string
  imageCount: number
  videoRefUrl?: string
  videoRefType?: string
  model?: string
}): string | null {
  const { prompt, imageCount, videoRefUrl, videoRefType, model } = opts

  // 1. Image reference check: prompt has images available but doesn't reference any
  const refs = [...new Set(
    Array.from(prompt.matchAll(/<<<image_(\d+)>>>/g), m => Number(m[1]))
  )]

  if (refs.length === 0 && imageCount > 0) {
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

  return null
}
