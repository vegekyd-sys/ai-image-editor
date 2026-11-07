import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleOmniVideoTask, GOOGLE_OMNI_MODEL, normalizeGoogleOmniMimeType } from '@/lib/google-omni-video'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('google omni video provider', () => {
  it('maps QuickTime MOV uploads to Google Omni supported MIME type', () => {
    expect(normalizeGoogleOmniMimeType('video/quicktime')).toBe('video/mov')
    expect(normalizeGoogleOmniMimeType(' video/quicktime ')).toBe('video/mov')
    expect(normalizeGoogleOmniMimeType('video/mp4')).toBe('video/mp4')
  })

  it('uses the 1.2 GA model and forwards output resolution', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('gemini-omni-1.2-flash')
      expect(body.response_format).toMatchObject({
        type: 'video',
        delivery: 'uri',
        resolution: '4k',
      })
      return new Response(JSON.stringify({
        id: 'v1_test',
        status: 'completed',
        output_video: {
          type: 'video',
          mime_type: 'video/mp4',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/test:download',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGoogleOmniVideoTask({
      prompt: 'A clean product shot.',
      images: [],
      resolution: '4k',
    })

    expect(GOOGLE_OMNI_MODEL).toBe('gemini-omni-1.2-flash')
    expect(result).toMatchObject({ status: 'completed', taskId: 'google-omni-v1_test' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('submits a single image as reference-to-video rather than image-to-video', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    let providerBody: Record<string, any> | undefined
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://example.com/subject.png') {
        return new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '3' },
        })
      }
      providerBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: 'v1_reference',
        status: 'completed',
        output_video: {
          type: 'video',
          mime_type: 'video/mp4',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/reference:download',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createGoogleOmniVideoTask({
      prompt: 'Keep <<<media_1>>> as the character identity in a new city scene.',
      images: ['https://example.com/subject.png'],
      aspectRatio: '9:16',
      resolution: '720p',
    })

    expect(providerBody?.generation_config).toEqual({ video_config: { task: 'reference_to_video' } })
    expect(providerBody?.input?.[0]).toMatchObject({ type: 'image', mime_type: 'image/png' })
    // 1.2 deprecates control tokens; roles are stated in natural language.
    expect(providerBody?.input?.at(-1)?.text).toContain('Keep Image 1 as the character identity')
    expect(providerBody?.input?.at(-1)?.text).not.toMatch(/<IMAGE_REF_|\[# /)
    expect(providerBody?.input?.at(-1)?.text).toContain('not as literal first frames')
    expect(providerBody?.input?.at(-1)?.text).not.toContain('starting frame')
  })

  it('extends one referenced video through the same reference-media input flow', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    let providerBody: Record<string, any> | undefined
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://example.com/source.mp4') {
        return new Response(Uint8Array.from([0, 1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '4' },
        })
      }
      providerBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: 'v1_extend',
        status: 'completed',
        output_video: {
          type: 'video',
          mime_type: 'video/mp4',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/extend:download',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGoogleOmniVideoTask({
      prompt: 'The camera continues pulling back and the music reaches its chorus.',
      images: [],
      duration: 10,
      resolution: '720p',
      operation: 'extend',
      videoUrl: 'https://example.com/source.mp4',
    })

    expect(result).toMatchObject({ status: 'completed', taskId: 'google-omni-v1_extend' })
    expect(providerBody?.generation_config).toEqual({ video_config: { task: 'extend' } })
    expect(providerBody?.response_format).toEqual({ type: 'video', delivery: 'uri', resolution: '720p', duration: '10s' })
    expect(providerBody?.input?.[0]?.content?.[0]).toMatchObject({ type: 'video', mime_type: 'video/mp4' })
    expect(providerBody?.input?.[0]?.content?.at(-1)?.text).toContain('Continue the attached source video forward from its last frame')
    expect(providerBody?.input?.[0]?.content?.at(-1)?.text).toContain('Preserve its visual style')
  })

  it('extends a Google-generated result statefully without re-uploading the cumulative video', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    let providerBody: Record<string, any> | undefined
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: 'v1_extend_turn_3',
        status: 'completed',
        output_video: {
          type: 'video',
          mime_type: 'video/mp4',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/extend-turn-3:download',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGoogleOmniVideoTask({
      prompt: 'Continue into the final chorus and reveal the Omni title.',
      images: [],
      duration: 10,
      resolution: '720p',
      operation: 'extend',
      previousInteractionId: 'v1_extend_turn_2',
    })

    expect(result).toMatchObject({ status: 'completed', taskId: 'google-omni-v1_extend_turn_3' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(providerBody).toMatchObject({
      previous_interaction_id: 'v1_extend_turn_2',
    })
    expect(providerBody).not.toHaveProperty('generation_config')
    expect(providerBody?.input).toContain('Continue the video from the previous turn')
    expect(providerBody?.response_format).toMatchObject({ duration: '10s' })
  })

  function stubOmni(onBody: (body: Record<string, any>) => void) {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://example.com/')) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } })
      }
      onBody(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({
        id: 'v1_next', status: 'completed',
        output_video: { type: 'video', mime_type: 'video/mp4', uri: 'https://generativelanguage.googleapis.com/v1beta/files/next:download' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends the 1.2 typed duration field for generation instead of prompt text', async () => {
    let body: Record<string, any> | undefined
    stubOmni(b => { body = b })
    await createGoogleOmniVideoTask({ prompt: 'Three beats in one shot.', images: [], duration: 15, aspectRatio: '16:9' })
    expect(body?.response_format).toMatchObject({ duration: '15s', aspect_ratio: '16:9' })
    expect(JSON.stringify(body?.input)).not.toContain('Target duration')
  })

  it('edits a Google-generated result as a follow-up turn without re-uploading it', async () => {
    let body: Record<string, any> | undefined
    const fetchMock = stubOmni(b => { body = b })
    const result = await createGoogleOmniVideoTask({
      prompt: 'Make Spark bright gold; keep everything else.',
      images: [],
      duration: 10,
      operation: 'edit',
      previousInteractionId: 'v1_turn_1',
    })
    expect(result).toMatchObject({ status: 'completed', taskId: 'google-omni-v1_next' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ previous_interaction_id: 'v1_turn_1', store: true })
    expect(body).not.toHaveProperty('generation_config')
    expect(body?.response_format).not.toHaveProperty('duration')
    expect(body?.response_format).not.toHaveProperty('aspect_ratio')
    expect(body?.input).toContain('Edit the video from the previous turn')
  })

  it('maps timeline markers to image ordinals even when a video occupies an earlier slot', async () => {
    let body: Record<string, any> | undefined
    stubOmni(b => { body = b })
    await createGoogleOmniVideoTask({
      prompt: 'Restyle <<<media_1>>> using the outfit from <<<media_2>>>.',
      images: ['', 'https://example.com/outfit.png'],
      operation: 'edit',
      previousInteractionId: 'v1_turn_1',
    })
    const text = body?.input?.at(-1)?.text
    expect(text).toContain('Restyle the source video using the outfit from Image 1.')
    expect(body?.input?.[0]).toMatchObject({ type: 'image' })
  })

  it('rejects mixing a previous interaction with an uploaded source video', async () => {
    stubOmni(() => {})
    await expect(createGoogleOmniVideoTask({
      prompt: 'Edit.', images: [], operation: 'edit', previousInteractionId: 'v1_turn_1', videoUrl: 'https://example.com/source.mp4',
    })).rejects.toThrow('not both')
  })
})
