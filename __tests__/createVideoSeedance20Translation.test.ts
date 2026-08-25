import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('createVideo Seedance 2.0 talking-head translation references', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('maps Makaron video and audio markers to the Evolink Seedance 2.0 contract', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-seedance20-translation' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Translated Talking Head\n\n<<<video_1>>> is the silent accepted A-roll. <<<audio_1>>> is voice identity only.\n\nShot 1 (7s): The same speaker says: "Have you ever had an idea?"\nSound: English dialogue only.',
      images: [],
      videoUrls: ['https://example.com/silent-source.mp4'],
      audioUrls: ['https://example.com/source-voice.mp3'],
      referenceVideoDuration: 7,
      referenceVideoMetas: [{ width: 720, height: 1280, fileSizeBytes: 2_000_000 }],
      duration: 7,
      aspectRatio: '9:16',
      videoModel: 'seedance-fast',
      videoResolution: '720p',
    })

    expect(result).toMatchObject({
      success: true,
      providerModel: 'seedance-2.0-fast-reference-to-video',
    })
    expect(providerBody).toMatchObject({
      model: 'seedance-2.0-fast-reference-to-video',
      video_urls: ['https://example.com/silent-source.mp4'],
      audio_urls: ['https://example.com/source-voice.mp3'],
      duration: 7,
      quality: '720p',
      aspect_ratio: '9:16',
    })
    expect(String(providerBody?.prompt)).toContain('@video1 is the silent accepted A-roll')
    expect(String(providerBody?.prompt)).toContain('@audio1 is voice identity only')
    expect(String(providerBody?.prompt)).not.toContain('<<<video_1>>>')
    expect(String(providerBody?.prompt)).not.toContain('<<<audio_1>>>')
  })
})
