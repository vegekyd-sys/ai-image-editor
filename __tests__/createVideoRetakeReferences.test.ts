// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import * as referencePreflight from '@/lib/h3-reference-preflight'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it.each([false, true, 'middle'])('keeps Retake boundary images and the exact final Agent prompt without marker-dependent filtering (native lock: %s)', async lockEndpoints => {
  const images = ['https://example.com/start.jpg', 'https://example.com/end.jpg', 'https://example.com/brand.jpg']
  const videoUrl = 'https://example.com/context.mp4'
  const prompt = '1–2s: wheel-level tracking. CUT. 2–4s: elevated view of the same landing. Integrate Image 3 as the supplied brand image.'
  vi.stubEnv('FAL_KEY', 'test-key')
  const preflight = vi.spyOn(referencePreflight, 'prepareH3ReferenceMedia').mockResolvedValue({
    videos: [{ url: videoUrl, durationSec: 5 }], audios: [],
    referenceImagePixels: 1280 * 720 * images.length, referenceVideoDurationSec: 5, referenceAudioDurationSec: 0,
  })
  let body: any
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ request_id: 'retake-reference-test' }), { status: 200 })
  }))
  const result = await createVideo({ script: prompt, images, videoUrl, videoModel: 'fal-h3-max',
    videoResolution: '768p', aspectRatio: '16:9', duration: 5, referenceVideoDuration: 5,
    h3RetakeBoundaryFrames: { startUrl: images[0], endUrl: images[1], lockEndpoints:!!lockEndpoints, ...(lockEndpoints === 'middle' ? {middle:{imageUrl:images[0],time:2.5}} : {}) } })
  expect(result.success).toBe(true)
  expect(preflight).toHaveBeenCalledWith(images, [videoUrl], [])
  expect(body).toMatchObject({ prompt, reference_image_urls: images,
    reference_video_urls: [videoUrl], prompt_expansion_mode: 'disabled' })
  if (lockEndpoints) expect(body).toMatchObject({image_url:images[0],end_image_url:images[1]})
  else expect(body).not.toHaveProperty('image_url')
  if (lockEndpoints==='middle') expect(body).toMatchObject({middle_image_url:images[0],middle_frame_time:2.5})
})
