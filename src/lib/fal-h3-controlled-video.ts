import type { CreateVideoInput, CreateVideoResult } from './skills/create-video'
import { h3ControlsSchema, type H3Controls } from './h3-controls'
import { buildFalH3TurboRequest } from './fal-h3-max-video'
import { buildH3MaxReferencePayload, H3_MAX_REFERENCE_ENDPOINT } from './fal-h3-max-reference-video'
import { prepareH3ReferenceMedia } from './h3-reference-preflight'
import type { VideoQuoteInput } from './billing/media-pricing'

function requireInput(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason)
}

/** fal publishes exact video examples for these frame counts. Other shapes/timings
 * need actual provider-unit settlement before they can be priced for customers. */
export function controlledReferenceTokens(media: Awaited<ReturnType<typeof prepareH3ReferenceMedia>>, duration: number, resolution: string, locked: boolean) {
  let tokens = locked ? 0 : media.referenceAudioDurationSec * 80
  requireInput(media.dimensions, 'Cannot verify selected H3 image dimensions.')
  for (const { width, height } of media.dimensions) {
    const ratio = Math.max(width, height) / Math.min(width, height)
    const shapes = new Map([[1,1024], [4/3,1376], [16/9,1824], [2.5,2560]])
    const count = shapes.get(ratio)
    if (count === undefined && media.dimensions.length === 1 && !media.videos.length && !tokens && ratio <= 2.5) return 0 // within the included allowance
    requireInput(count !== undefined, 'Reference image aspect ratio has no verified experimental price.')
    tokens += count
  }
  const table = new Map([[48,[4680,12096]], [120,[12480,32256]], [240,[26130,67536]], [360,[39780,102816]]])
  for (const clip of media.videos) {
    const count = table.get(clip.frameCount ?? 0)
    requireInput(clip.width && clip.height && Math.max(clip.width,clip.height)/Math.min(clip.width,clip.height) === 16/9 &&
      clip.fps === 24 && clip.frameCount && clip.frameCount <= duration * 24 && count,
      'Unverified H3 video-reference tariff. This experiment prices 16:9 or 9:16 at 24 fps, 48/120/240/360 frames within the output duration.')
    tokens += count[resolution === '480p' ? 0 : 1]
  }
  return tokens
}

export function buildControlledH3Request(input: CreateVideoInput, controls: H3Controls, media: Awaited<ReturnType<typeof prepareH3ReferenceMedia>>) {
  const turbo = controls.kind.startsWith('turbo-')
  const model = turbo ? 'minimax-h3-max' : 'fal-h3-max'
  requireInput(input.videoModel === model, 'Explicit H3 operation requires its matching selected model.')
  const resolution = !input.videoResolution || input.videoResolution === 'auto' ? '768p' : input.videoResolution
  requireInput(resolution === '480p' || resolution === '768p' || resolution === '1080p', 'H3 controls support 480p, 768p or 1080p.')
  const images = input.images
  const { videos, audios } = media
  const duration = input.duration ?? 5
  const prompt = input.script.trim()
  const aspect = input.aspectRatio && input.aspectRatio !== 'auto' ? input.aspectRatio : undefined
  requireInput(!aspect || ['16:9','9:16','1:1','21:9','4:3','3:4'].includes(aspect), 'Unsupported H3 aspect ratio.')
  requireInput(prompt.length <= 50_000, 'H3 prompt exceeds 50000 characters.')
  requireInput(!input.videoOperation || input.videoOperation === 'generate', 'Use the explicit H3 operation alone.')
  requireInput(!input.retake && !input.h3RetakeBoundaryFrames && !input.imageWorkflow && !input.referenceVoiceIds?.length && !input.motionControl && input.generateAudio == null && !input.webSearch && !input.outputFormat && input.keepOriginalSound !== false && input.contentFilter !== false, 'Conflicting controls for this H3 operation.')
  const locked = 'lockAudio' in controls && controls.lockAudio
  if (locked) requireInput(audios.length === 1, 'A locked soundtrack requires exactly one selected audio file.')
  const usage: VideoQuoteInput = { model, resolution, durationSec: duration, imageCount: images.length, h3Operation: controls.kind }
  const common = { resolution: resolution.toUpperCase(), enable_safety_checker: true }
  let endpoint: string
  let payload: Record<string, unknown>
  switch (controls.kind) {
    case 'max-reference': {
      requireInput(locked || controls.order, 'Select a locked soundtrack or an ordered list of references.')
      const refs = locked ? [] : audios
      const hasVisual = images.length > 0 || videos.length > 0
      endpoint = hasVisual ? H3_MAX_REFERENCE_ENDPOINT : 'minimax/h3-max/text-to-video'
      payload = buildH3MaxReferencePayload({ images, videos, audios: refs, resolution, duration, prompt, aspectRatio: aspect,
        referenceOrder: controls.order, targetAudioUrl: locked ? audios[0].url : undefined })
      if (!hasVisual) {
        delete payload.reference_image_urls
        delete payload.reference_video_urls
        delete payload.reference_audio_urls
        payload.aspect_ratio = aspect ?? '16:9'
      }
      Object.assign(usage, { measuredReferenceTokens: controlledReferenceTokens(media, duration, resolution, Boolean(locked)), referenceImagePixels: media.referenceImagePixels, referenceVideoDurationSec: media.referenceVideoDurationSec,
        referenceAudioDurationSec: locked ? 0 : media.referenceAudioDurationSec })
      break
    }
    case 'turbo-generation': {
      requireInput(videos.length === 0 && (locked || !audios.length), 'Turbo generation accepts keyframes and one explicitly locked soundtrack.')
      requireInput(!aspect || !images.length, 'Turbo image generation follows the keyframe canvas.')
      const request = buildFalH3TurboRequest({ images, prompt, duration, aspectRatio: aspect }, {
        frames: controls.frames, targetAudioUrl: locked ? audios[0].url : undefined, resolution,
      })
      endpoint = request.endpoint
      payload = request.payload
      break
    }
    case 'camera': {
      requireInput(images.length === 1 && !videos.length && !audios.length && !aspect, 'Camera controls require a single image and follow its canvas.')
      requireInput(Number.isInteger(duration) && duration >= 5 && duration <= 15, 'Camera duration must be 5–15 seconds.')
      const poses = controls.trajectory
      let travel = 0
      for (let i = 1; i < poses.length; i++) {
        requireInput(poses[i].time > poses[i-1].time, 'Camera keyframes must be strictly ordered in time.')
        travel += Math.abs(poses[i].azimuth - poses[i-1].azimuth)
      }
      requireInput(travel <= 32 * 360, 'Camera path exceeds 32 turns.')
      endpoint = 'minimax/h3-max/camera-controls'
      payload = { ...common, duration, prompt, prompt_expansion_mode: 'balanced', image_url: images[0], camera_trajectory: poses }
      break
    }
    case 'turbo-extend': {
      requireInput(!images.length && videos.length === 1 && !audios.length && prompt, 'Turbo Extend requires one short source video and a continuation prompt.')
      requireInput(Number.isInteger(duration) && duration >= 5 && duration <= 15, 'Turbo Extend adds 5–15 seconds.')
      endpoint = 'minimax/h3-max-turbo/extend-video'
      payload = { ...common, video_url: videos[0].url, duration, prompt, aspect_ratio: aspect ?? 'auto', output: 'extended', enable_prompt_expansion: true }
      break
    }
    case 'photo-lipsync': {
      requireInput(images.length === 1 && !videos.length && audios.length === 1 && audios[0].durationSec >= 5 && !aspect, 'Photo lip sync requires one portrait and 5–15s of speech.')
      endpoint = 'minimax/h3-max/lip-sync/image-to-video'
      usage.durationSec = audios[0].durationSec
      payload = { ...common, image_url: images[0], audio_url: audios[0].url }
      break
    }
    default: {
      requireInput(videos.length === 1 && !audios.length, 'H3 video editing requires one source video with its original audio.')
      const source = videos[0]
      usage.durationSec = source.durationSec
      payload = { ...common, video_url: source.url }
      if (controls.kind === 'reframe') {
        requireInput(!images.length && aspect, 'Reframe requires a target aspect ratio and no images.')
        // Only short single-window inputs have a known pre-submission tariff.
        requireInput(source.durationSec <= 5, 'Experimental reframe accepts sources up to 5s for single-window billing.')
        endpoint = 'minimax/h3-max/reframe-video'
        Object.assign(payload, { resolution, aspect_ratio: aspect, prompt })
      } else if (controls.kind === 'relight') {
        requireInput(images.length === 1 && source.durationSec >= 2.34 && !aspect, 'Relight requires one lighting sphere and at least 2.34s of source video.')
        const sourceFrames = Math.round(source.durationSec * 24)
        usage.durationSec = (Math.floor((sourceFrames - 5) / 17) * 17 + 5) / 24
        requireInput(usage.durationSec * 24 >= 56, 'Source too short after Relight preparation.')
        endpoint = 'minimax/h3-max/relight'
        payload.reference_image_url = images[0]
      } else {
        requireInput(images.length >= 1 && images.length <= 3 && source.durationSec >= 5 && resolution !== '480p' && !aspect, 'Recast requires 1–3 portraits and a 5–15s source at 768p or 1080p.')
        endpoint = 'minimax/h3-max/recast'
        Object.assign(payload, { reference_image_urls: images, prompt })
      }
    }
  }
  return { endpoint, payload, usage, turbo }
}

export async function prepareControlledH3Request(input: CreateVideoInput) {
  const controls = h3ControlsSchema.parse(input.h3Controls)
  requireInput(process.env.MAKARON_H3_EXPERIMENTS?.split(',').includes(controls.kind), 'This H3 operation is experimental and is disabled on this deployment.')
  requireInput(controls.kind !== 'recast', 'Recast is unavailable pending measured per-shot pricing and latency acceptance.')
  const videos = [...(input.videoUrl ? [input.videoUrl] : []), ...(input.videoUrls ?? [])]
  const audios = input.audioUrls ?? []
  requireInput(input.images.length <= 9 && videos.length <= 3 && audios.length <= 3 && input.images.length + videos.length + audios.length <= 13, 'Too many H3 inputs.')
  requireInput([...input.images, ...videos, ...audios].every(url => url.startsWith('https://')), 'H3 experiment inputs require HTTPS media URLs.')
  const media = await prepareH3ReferenceMedia(input.images, videos, audios, 'lockAudio' in controls && controls.lockAudio ? 15_000_000 : undefined, controls.kind === 'max-reference')
  return buildControlledH3Request(input, controls, media)
}

export async function createControlledH3Video(input: CreateVideoInput): Promise<CreateVideoResult> {
  let posted = false
  try {
    const { endpoint, payload, usage, turbo } = await prepareControlledH3Request(input)
    const key = process.env.FAL_KEY?.trim()
    requireInput(key, 'FAL_KEY not configured')
    await input.onBeforeProviderSubmit?.(usage)
    posted = true
    const response = await fetch('https://queue.fal.run/' + endpoint, {
      method: 'POST', headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if ([400,401,402,403,404,413,415,422,429].includes(response.status)) posted = false
    requireInput(response.ok, 'H3 submission HTTP ' + response.status)
    const body = await response.json()
    requireInput(typeof body.request_id === 'string' && body.request_id.length > 0, 'H3 submission receipt missing.')
    const taskId = (turbo ? 'fal-h3max-turbo-' : 'fal-h3max-reference-') + body.request_id
    return { success: true, taskId, providerModel: endpoint, videoModel: input.videoModel, status: 'processing', message: 'H3 submitted. Poll the original task.' }
  } catch (error) {
    return { success: false, retryable: false, submissionUncertain: posted, message: posted ? 'H3 submission outcome unknown. Reconcile the original request.' : error instanceof Error ? error.message : 'Invalid H3 controls.' }
  }
}
