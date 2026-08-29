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

  it('uses the 1.1 GA model and forwards output resolution', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('gemini-omni-1.1-flash')
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

    expect(GOOGLE_OMNI_MODEL).toBe('gemini-omni-1.1-flash')
    expect(result).toMatchObject({ status: 'completed', taskId: 'google-omni-v1_test' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    expect(providerBody?.response_format).toEqual({ type: 'video', delivery: 'uri', resolution: '720p' })
    expect(providerBody?.input?.[0]?.content?.[0]).toMatchObject({ type: 'video', mime_type: 'video/mp4' })
    expect(providerBody?.input?.[0]?.content?.at(-1)?.text).toContain('Continue Video1 forward from its tail')
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
      prompt: 'Continue into the final chorus and reveal the Omni 1.1 title.',
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
    expect(providerBody?.input).toContain('Continue the video from the previous interaction')
  })
})
