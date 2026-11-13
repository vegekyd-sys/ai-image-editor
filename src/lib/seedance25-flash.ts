import type { EvolinkTaskInput } from './evolink'

/** EvoLink Flash contract, observed 2026-11-13. Do not inherit ordinary2.5 fields. */
export function buildSeedance25FlashPayload(input: EvolinkTaskInput): Record<string, unknown> {
  const { model, prompt, images, videoUrls = [], audioUrls = [] } = input
  const prefix = 'seedance-2.5-flash-'
  const mode = model?.slice(prefix.length)
  if (!model?.startsWith(prefix) || !['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit'].includes(mode!)) throw new Error('Unsupported Seedance 2.5 Flash route.')
  if (!prompt.trim()) throw new Error('Seedance 2.5 Flash requires a prompt.')
  if (input.contentFilter === false || input.outputFormat === 'mov' || input.webSearch) throw new Error('Seedance 2.5 Flash does not support relaxed content filtering, MOV or web search.')
  if (input.quality && !['480p', '720p'].includes(input.quality)) throw new Error('Seedance 2.5 Flash supports only 480p or 720p.')
  if (images.length > 10 || videoUrls.length > 5 || audioUrls.length > 5) throw new Error('Seedance 2.5 Flash accepts at most 10 images,5 videos and5 audios.')
  for (const url of [...images, ...videoUrls, ...audioUrls]) {
    let valid = false
    try { valid = ['http:', 'https:'].includes(new URL(url).protocol) } catch { /* rejected below */ }
    if (!valid) throw new Error('Seedance 2.5 Flash references must be HTTP(S) URLs.')
  }
  if (mode === 'text-to-video' && (images.length || videoUrls.length || audioUrls.length)) throw new Error('Flash text-to-video does not accept references.')
  if (mode === 'image-to-video' && (images.length < 1 || images.length > 2 || videoUrls.length || audioUrls.length)) throw new Error('Flash image-to-video needs 1–2 images and no video/audio references.')
  if (mode === 'reference-to-video' && !images.length && !videoUrls.length && !audioUrls.length) throw new Error('Flash reference-to-video requires at least one reference.')
  if (mode === 'video-edit' && videoUrls.length !== 1) throw new Error('Flash edit requires exactly one source video.')
  const payload: Record<string, unknown> = { model, prompt, quality: input.quality ?? '720p', generate_audio: input.generateAudio ?? true }
  if (mode === 'video-edit') {
    if (input.duration != null) throw new Error('Flash edit follows source duration; omit duration (not -1).')
  } else {
    const duration = input.duration ?? 5
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('Seedance 2.5 Flash duration must be an integer 4–30 seconds.')
    payload.duration = duration
  }
  if (mode === 'text-to-video' || mode === 'reference-to-video') {
    const aspect = input.aspectRatio ?? '16:9'
    if (!['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'].includes(aspect)) throw new Error('Unsupported Seedance 2.5 Flash aspect ratio.')
    payload.aspect_ratio = aspect
  } else if (input.aspectRatio) throw new Error('Flash first/last frame and edit follow the source canvas; omit aspect ratio.')
  if (images.length) payload.image_urls = images
  if (videoUrls.length) payload.video_urls = videoUrls
  if (audioUrls.length) payload.audio_urls = audioUrls
  return payload
}
