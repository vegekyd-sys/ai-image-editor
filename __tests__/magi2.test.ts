import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculateMediaQuote, type MediaPrice, videoPriceId } from '../src/lib/billing/media-pricing'
import { getDefaultVideoModelId, getVideoModelCapability, resolveVideoProviderModel, validateVideoModelRequest } from '../src/lib/video-model-capabilities'
import { buildMagi2Payload } from '../src/lib/magi2'
import { createVideo } from '../src/lib/skills/create-video'
import { getVideoStatus } from '../src/lib/skills/get-video-status'

const image = 'https://media.example.com/hero.png?sign=test'
const video = 'https://media.example.com/motion.mp4'
const audio = 'https://media.example.com/line.wav'
const endpoint = 'https://api.evolink.ai/v1/videos/generations'
const request = { script: 'A paper robot turns toward the camera.', images: [], videoModel: 'magi-2' }
const payload = { images: [], duration: 4, generateAudio: false }
const id = 'task-unified-1774857405-abc123'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MAGI-2 via EvoLink', () => {
  it('exposes all three explicit routes and charges only requested output seconds', () => {
    expect(getDefaultVideoModelId()).toBe('kling-4-flash')
    expect(getVideoModelCapability('magi-2')).toMatchObject({ provider: 'evolink', defaultResolution: '1080p' })
    expect(resolveVideoProviderModel({ model: 'magi-2' })).toBe('magi-2-text-to-video')
    expect(resolveVideoProviderModel({ model: 'magi-2', imageReferenceCount: 1 })).toBe('magi-2-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'magi-2', hasAudioReference: true })).toBe('magi-2-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'magi-2', imageWorkflow: 'image-to-video', imageReferenceCount: 1 })).toBe('magi-2-image-to-video')
    expect(validateVideoModelRequest({ model: 'magi-2', outputDuration: 30, aspectRatio: '3:4', imageReferenceCount: 10, videoReferenceCount: 5, audioReferenceCount: 5 })).toBeNull()
    const invalidRequests: Array<Parameters<typeof validateVideoModelRequest>[0]> = [
      { outputDuration: -1 }, { outputDuration: 3 }, { outputDuration: 4.5 }, { outputDuration: 31 },
      { imageReferenceCount: 11 }, { videoReferenceCount: 6 }, { audioReferenceCount: 6 },
      { referenceVideoMetas: [{ durationSec: 1.99 }] }, { referenceVideoDuration: 30.1 },
      { imageWorkflow: 'image-to-video', imageReferenceCount: 0 },
      { imageWorkflow: 'image-to-video', imageReferenceCount: 2, audioReferenceCount: 1 },
      { resolution: '720p' }, { aspectRatio: '3:2' },
      { aspectRatio: '21:9', imageWorkflow: 'image-to-video', imageReferenceCount: 1 }, { operation: 'edit' }, { operation: 'extend' },
    ]
    for (const invalid of invalidRequests) expect(validateVideoModelRequest({ model: 'magi-2', ...invalid })).toBeTruthy()
    const migration = readFileSync('supabase/migrations/20261125170000_magi2_pricing.sql', 'utf8')
    const priceId = videoPriceId({ model: 'magi-2' })
    expect(migration).toContain(`('${priceId}', 'video', 'magi-2', '1080p', 'generate', 0.08)`)
    const price = {
      id: priceId, model_id: 'magi-2', resolution: '1080p', kind: 'video', operation: 'generate',
      output_usd_per_second: 0.08, input_usd_per_second: 0, input_usd_per_image: 0,
      free_image_references: 0, markup: 2, unfiltered_multiplier: 1, is_active: true, updated_at: 'test',
    } satisfies MediaPrice
    expect(calculateMediaQuote(price, { durationSec: 30, imageCount: 10, referenceVideoDurationSec: 30, referenceAudioDurationSec: 30 }))
      .toMatchObject({ supplierCostUsd: 2.4, credits: 480, durationSec: 30 })
  })

  it('requires a prompt everywhere and uses EvoLink’s workflow-specific aspect ratios', () => {
    const textModel = 'magi-2-text-to-video'
    const frameModel = 'magi-2-image-to-video'
    const images = [image, 'https://media.example.com/end.png']
    const frames = { ...payload, model: frameModel, prompt: '  Dolly forward slowly.  ', images }
    expect(buildMagi2Payload({ ...payload, model: textModel, prompt: request.script, aspectRatio: '21:9' })).toEqual({
      model: textModel, prompt: request.script, duration: 4, quality: '1080p', aspect_ratio: '21:9', generate_audio: false,
    })
    expect(buildMagi2Payload(frames)).toEqual({
      model: frameModel, prompt: 'Dolly forward slowly.', duration: 4, quality: '1080p', aspect_ratio: 'auto',
      generate_audio: false, image_urls: images,
    })
    expect(buildMagi2Payload({ ...frames, aspectRatio: 'auto' })).toHaveProperty('aspect_ratio', 'auto')
    expect(buildMagi2Payload({ ...frames, aspectRatio: '4:3' })).toHaveProperty('aspect_ratio', '4:3')
    expect(() => buildMagi2Payload({ ...frames, aspectRatio: '21:9' })).toThrow(/first\/last frame mode/)
    const reference = { ...payload, model: 'magi-2-reference-to-video', prompt: '🌱'.repeat(15_000), images: [image], videoUrls: [video], audioUrls: [audio] }
    expect(buildMagi2Payload({ ...reference, aspectRatio: '21:9' })).toMatchObject({
      model: 'magi-2-reference-to-video', prompt: reference.prompt, image_urls: [image], video_urls: [video], audio_urls: [audio], aspect_ratio: '21:9',
    })
    for (const input of [{ ...payload, model: textModel }, frames, reference]) {
      expect(() => buildMagi2Payload({ ...input, prompt: ' \n ' })).toThrow(/non-blank/)
    }
    expect(() => buildMagi2Payload({ ...reference, prompt: reference.prompt + 'a' })).toThrow(/15,000/)
    expect(() => buildMagi2Payload({ ...reference, images: ['http://media.example.com/hero.png'] })).toThrow(/HTTPS/)
  })

  it('preflights invalid frame requests before reservation and preserves frame order', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ id, model: 'magi-2-image-to-video' }))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('EVOLINK_API_KEY', 'unit-test-key')
    const reserve = vi.fn(async () => { expect(fetch).not.toHaveBeenCalled() })
    const frames = [image, 'https://media.example.com/end.png']
    const input = { ...request, images: frames, imageWorkflow: 'image-to-video' as const, onBeforeProviderSubmit: reserve }
    await expect(createVideo({ ...input, script: ' ' })).resolves.toMatchObject({ success: false, retryable: false, submissionUncertain: false })
    await expect(createVideo({ ...input, aspectRatio: '21:9' })).resolves.toMatchObject({ success: false, retryable: false, submissionUncertain: false })
    expect(reserve).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await expect(createVideo({ ...input, script: 'End on <<<media_2>>> after starting at <<<media_1>>>.' })).resolves.toMatchObject({ success: true })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      model: 'magi-2-image-to-video', aspect_ratio: 'auto', image_urls: frames,
      prompt: 'End on Image 2 after starting at Image 1.',
    })
  })

  it('preflights references before reservation, posts once, and delivers the original video URL', async () => {
    const asset = 'https://output.example.com/video.mp4?sign=test'
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id, model: 'magi-2-reference-to-video' }))
      .mockResolvedValueOnce(Response.json({ id, status: 'completed', results: [asset] }))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('EVOLINK_API_KEY', 'unit-test-key')
    const reserve = vi.fn(async () => { expect(fetch).toHaveBeenCalledTimes(0) })
    const submission = await createVideo({
      ...request, script: 'Follow <<<media_2>>> then match <<<media_1>>>; use <<<video_1>>> as motion.',
      images: [image, 'https://media.example.com/side.png'], videoUrls: [video],
      referenceVideoMetas: [{ width: 1920, height: 1080, durationSec: 3, fileSizeBytes: 100 }],
      duration: 4, generateAudio: false, onBeforeProviderSubmit: reserve,
    })
    expect(submission).toMatchObject({ success: true, videoModel: 'magi-2', providerModel: 'magi-2-reference-to-video', provider: 'evolink' })
    expect(reserve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'magi-2', durationSec: 4, imageCount: 2, referenceVideoDurationSec: 3 }))
    expect(fetch.mock.calls[0][0]).toBe(endpoint)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      model: 'magi-2-reference-to-video', quality: '1080p', duration: 4, generate_audio: false,
      prompt: 'Follow Image 1 then match Image 2; use Video 1 as motion.',
      image_urls: ['https://media.example.com/side.png', image], video_urls: [video],
    })
    await expect(getVideoStatus({ taskId: submission.taskId! })).resolves.toMatchObject({ status: 'completed', videoUrl: asset })
    expect(fetch.mock.calls[1][0]).toBe(`https://api.evolink.ai/v1/tasks/${id}`)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not resend an ambiguous POST or charge before a missing key is detected', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('timeout'))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('EVOLINK_API_KEY', '')
    const reserve = vi.fn(async () => {})
    await expect(createVideo({ ...request, onBeforeProviderSubmit: reserve })).resolves.toMatchObject({ success: false, submissionUncertain: false })
    expect(reserve).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('EVOLINK_API_KEY', 'unit-test-key')
    await expect(createVideo({ ...request, onBeforeProviderSubmit: reserve })).resolves.toMatchObject({ success: false, submissionUncertain: true, retryable: false })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('distinguishes an explicit provider rejection from an ambiguous receipt', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'insufficient_credits' } }, { status: 402 }))
      .mockResolvedValueOnce(Response.json({ id: 'invalid' }))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('EVOLINK_API_KEY', 'unit-test-key')
    await expect(createVideo(request)).resolves.toMatchObject({ success: false, submissionUncertain: false, errorCode: 'evolink_submission_rejected' })
    await expect(createVideo(request)).resolves.toMatchObject({ success: false, submissionUncertain: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
