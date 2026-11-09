import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const imageBytes = new Map<string, Buffer>()
vi.mock('../src/lib/provider-image-preflight', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/provider-image-preflight')>()),
  readProviderImage: vi.fn(async (source: string) => {
    const bytes = imageBytes.get(source)
    if (!bytes) throw new Error('Image unavailable or too large')
    return bytes
  }),
}))

import { createVideo, prepareKling4References } from '../src/lib/skills/create-video'
import { validateVideoScript } from '../src/lib/video-harness'
import { getDefaultVideoModelId, resolveAgentVideoSelection, validateVideoModelRequest } from '../src/lib/video-model-capabilities'

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#888' } }).png().toBuffer()

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); imageBytes.clear() })

function stubKlingSubmit() {
  vi.stubEnv('EVOLINK_API_KEY', 'test')
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ id: 'task-unified-default' }), { status: 200 })
  }))
  return bodies
}

describe('Kling 4.0 Flash as the default video model', () => {
  it('is the default and stays overridable by the Agent while the app selector is automatic', () => {
    expect(getDefaultVideoModelId()).toBe('kling-4-flash')
    expect(resolveAgentVideoSelection({ toolModel: 'seedance-2.5' })).toMatchObject({ model: 'seedance-2.5-eco', locked: false })
    expect(resolveAgentVideoSelection({ appModel: 'fal-h3-max', appAuto: false, toolModel: 'kling-4-flash' })).toMatchObject({ model: 'fal-h3-max', locked: true })
  })

  it('maps one shared media namespace onto separate Kling image and video inputs', () => {
    // media_1 image, media_2 timeline video (blanked by the Agent), media_3 image.
    const prepared = prepareKling4References({
      prompt: 'Shot 1: <<<media_3>>> walks like <<<media_2>>> wearing the outfit of <<<media_1>>>.',
      images: ['https://cdn.example/outfit.png', '', 'https://cdn.example/person.png'],
      videoUrls: ['https://cdn.example/dance.mp4'],
    })
    expect(prepared.images).toEqual(['https://cdn.example/person.png', 'https://cdn.example/outfit.png'])
    expect(prepared.prompt).toBe('Shot 1: <<<image_1>>> walks like <<<video_1>>> wearing the outfit of <<<image_2>>>.')
  })

  it('keeps explicit video markers and references unmentioned videos without misnumbering', () => {
    expect(prepareKling4References({ prompt: 'Restyle <<<video_1>>> as watercolor.', images: [], videoUrls: ['https://cdn.example/a.mp4'], operation: 'edit' }).prompt)
      .toBe('Restyle <<<video_1>>> as watercolor.')
    expect(prepareKling4References({ prompt: 'Make it night.', images: [], videoUrls: ['https://cdn.example/a.mp4'], operation: 'edit' }).prompt)
      .toBe('Edit <<<video_1>>>: Make it night.')
    expect(prepareKling4References({ prompt: '<<<media_1>>> dances.', images: ['https://cdn.example/p.png'], videoUrls: ['https://cdn.example/a.mp4'] }).prompt)
      .toBe('<<<image_1>>> dances.\nUse <<<video_1>>> as motion, camera, and visual-style references.')
  })

  it('submits a timeline video referenced as <<<media_N>>> as Kling video input', async () => {
    const bodies = stubKlingSubmit()
    const result = await createVideo({
      script: 'Replace the jacket in <<<media_1>>> with a red raincoat.',
      images: [''],
      videoUrls: ['https://cdn.example/source.mp4'],
      referenceVideoMetas: [{ durationSec: 6, width: 1080, height: 1920, fileSizeBytes: 1000 }],
      duration: 6,
      videoModel: 'kling-4-flash',
    })
    expect(result).toMatchObject({ success: true, videoModel: 'kling-4-flash' })
    expect(bodies[0]).toMatchObject({
      model: 'kling-v4-flash-reference-to-video',
      prompt: 'Replace the jacket in <<<video_1>>> with a red raincoat.',
      video_urls: ['https://cdn.example/source.mp4'],
      aspect_ratio: '9:16',
    })
    expect(bodies[0]).not.toHaveProperty('image_urls')
  })

  it.each([
    [1080, 1920, '9:16'],
    [1920, 1080, '16:9'],
    [1200, 1200, '1:1'],
  ])('follows a %sx%s first reference image when aspect_ratio is omitted', async (width, height, expected) => {
    imageBytes.set('https://cdn.example/product.png', await png(width, height))
    const bodies = stubKlingSubmit()
    const result = await createVideo({ script: '<<<media_1>>> rotates slowly on a pedestal.', images: ['https://cdn.example/product.png'], duration: 5 })
    expect(result).toMatchObject({ success: true, videoModel: 'kling-4-flash' })
    expect(bodies[0]).toMatchObject({ model: 'kling-v4-flash-reference-to-video', aspect_ratio: expected, image_urls: ['https://cdn.example/product.png'] })
  })

  it('keeps an explicit aspect ratio and falls back to 16:9 when the image cannot be read', async () => {
    imageBytes.set('https://cdn.example/product.png', await png(1080, 1920))
    let bodies = stubKlingSubmit()
    await createVideo({ script: '<<<media_1>>> spins.', images: ['https://cdn.example/product.png'], duration: 5, aspectRatio: '1:1' })
    expect(bodies[0]).toMatchObject({ aspect_ratio: '1:1' })
    bodies = stubKlingSubmit()
    await createVideo({ script: '<<<media_1>>> spins.', images: ['https://cdn.example/missing.png'], duration: 5 })
    expect(bodies[0]).toMatchObject({ aspect_ratio: '16:9' })
  })

  it('stops an over-long Kling script before billing with a repairable message', async () => {
    const prompt = `Title\n${'A calm product reveal with soft studio light. '.repeat(60)}`
    expect(prompt.length).toBeGreaterThan(2500)
    expect(validateVideoScript({ prompt, imageCount: 0, model: 'kling-4-flash', duration: 5 })).toMatch(/limited to 2500 characters, but this story_prompt has \d+\. Rewrite it once/)
    expect(validateVideoScript({ prompt, imageCount: 0, model: 'fal-h3-max', duration: 5 })).toBeNull()
    const reserve = vi.fn(), fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await createVideo({ script: prompt, images: [], duration: 5, onBeforeProviderSubmit: reserve })
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('limited to 2500 characters') })
    expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })

  it('points an unchosen 21-30s request at Seedance 2.5 instead of splitting', () => {
    expect(validateVideoScript({ prompt: 'One take', imageCount: 0, model: 'kling-4-flash', duration: 25 }))
      .toContain('resubmit this 21-30s request as one model="seedance-2.5" generation')
  })

  it('only rejects a measured Kling reference clip shorter than 3 seconds', () => {
    const base = { model: 'kling-4-flash', hasVideoReference: true, videoReferenceCount: 1 }
    expect(validateVideoModelRequest({ ...base, referenceVideoMetas: [{ width: 720, height: 1280 }] })).toBeNull()
    expect(validateVideoModelRequest({ ...base, referenceVideoMetas: [{ durationSec: 8, width: 720, height: 1280 }] })).toBeNull()
    expect(validateVideoModelRequest({ ...base, referenceVideoMetas: [{ durationSec: 2, width: 720, height: 1280 }] })).toContain('at least 3 seconds')
  })
})
