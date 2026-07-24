import { afterEach, describe, expect, it, vi } from 'vitest'
import { inferVolcengineTtsResourceId, listVolcengineTtsVoices, synthesizeWithVolcengineTts } from '@/lib/volcengine-tts'

describe('volcengine TTS client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('submits Seed TTS, polls the task, and downloads audio', async () => {
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', 'speech-api-key')

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      const headers = init?.headers as Record<string, string>

      if (href.endsWith('/submit')) {
        const body = JSON.parse(String(init?.body))
        expect(headers['X-Api-Key']).toBe('speech-api-key')
        expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0')
        expect(headers['X-Control-Require-Usage-Tokens-Return']).toBe('*')
        expect(body.user.uid).toBe('user-1')
        expect(body.req_params.text).toBe('你好，Makaron。')
        expect(body.req_params.speaker).toBe('zh_female_vv_uranus_bigtts')
        expect(body.req_params.audio_params).toMatchObject({
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: 0,
          enable_timestamp: true,
        })
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: { task_id: 'task-1' },
        }), { status: 200 })
      }

      if (href.endsWith('/query')) {
        const body = JSON.parse(String(init?.body))
        expect(body.task_id).toBe('task-1')
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: {
            task_status: 2,
            audio_url: 'https://cdn.example.com/voice.mp3',
            req_text_length: 11,
            synthesize_text_length: 11,
            sentences: [{ text: '你好，Makaron。' }],
            usage: { text_words: 11 },
          },
        }), { status: 200 })
      }

      if (href === 'https://cdn.example.com/voice.mp3') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeWithVolcengineTts({
      text: '你好，Makaron。',
      uid: 'user-1',
      requestId: 'req-1',
      pollIntervalMs: 1,
    })

    expect(result.taskId).toBe('task-1')
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.voiceId).toBe('zh_female_vv_uranus_bigtts')
    expect(result.sentences).toHaveLength(1)
    expect(result.usage).toEqual({ text_words: 11 })
  })

  it('fails clearly when TTS credentials are missing', async () => {
    vi.stubEnv('DOUBAO_SPEECH_API_KEY', '')
    vi.stubEnv('VOLCENGINE_TTS_API_KEY', '')
    vi.stubEnv('VOLCANO_SPEECH_API_KEY', '')
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', '')
    vi.stubEnv('VOLCENGINE_TTS_APP_ID', '')
    vi.stubEnv('VOLCENGINE_TTS_ACCESS_KEY', '')

    await expect(synthesizeWithVolcengineTts({
      text: 'hello',
      requestId: 'req-2',
    })).rejects.toThrow('Missing Volcengine TTS credentials')
  })

  it('infers the legacy Seed TTS resource for Mars voices', async () => {
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', 'speech-api-key')
    vi.stubEnv('VOLCENGINE_TTS_RESOURCE_ID', '')

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      const headers = init?.headers as Record<string, string>
      if (href.endsWith('/submit')) {
        expect(headers['X-Api-Resource-Id']).toBe('seed-tts-1.0')
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: { task_id: 'task-mars' },
        }), { status: 200 })
      }
      if (href.endsWith('/query')) {
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: { task_status: 2, audio_url: 'https://cdn.example.com/mars.mp3' },
        }), { status: 200 })
      }
      if (href === 'https://cdn.example.com/mars.mp3') {
        return new Response(new Uint8Array([4, 5, 6]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeWithVolcengineTts({
      text: 'Makaron，让创意开始。',
      voiceId: 'zh_female_zhixingnvsheng_mars_bigtts',
      requestId: 'req-mars',
      pollIntervalMs: 1,
    })

    expect(inferVolcengineTtsResourceId(result.voiceId)).toBe('seed-tts-1.0')
    expect(result.resourceId).toBe('seed-tts-1.0')
  })

  it('corrects an explicit Seed TTS 2.0 resource for legacy Moon voices', async () => {
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', 'speech-api-key')

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      const headers = init?.headers as Record<string, string>
      if (href.endsWith('/submit')) {
        expect(headers['X-Api-Resource-Id']).toBe('seed-tts-1.0')
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: { task_id: 'task-moon' },
        }), { status: 200 })
      }
      if (href.endsWith('/query')) {
        return new Response(JSON.stringify({
          code: 20000000,
          message: 'ok',
          data: { task_status: 2, audio_url: 'https://cdn.example.com/moon.mp3' },
        }), { status: 200 })
      }
      if (href === 'https://cdn.example.com/moon.mp3') {
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeWithVolcengineTts({
      text: 'Meet Makaron.',
      voiceId: 'en_male_campaign_jamal_moon_bigtts',
      resourceId: 'seed-tts-2.0',
      requestId: 'req-moon',
      pollIntervalMs: 1,
    })

    expect(result.resourceId).toBe('seed-tts-1.0')
  })

  it('fetches and normalizes the dynamic ListSpeakers voice catalog', async () => {
    vi.stubEnv('VOLCENGINE_ACCESS_KEY_ID', 'ak-test')
    vi.stubEnv('VOLCENGINE_SECRET_ACCESS_KEY', 'sk-test')

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      const headers = init?.headers as Record<string, string>
      expect(href).toContain('Action=ListSpeakers')
      expect(href).toContain('Version=2025-05-20')
      expect(headers.Authorization).toContain('HMAC-SHA256 Credential=ak-test/')
      expect(headers.Authorization).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date')
      expect(headers['X-Content-Sha256']).toBeTruthy()
      expect(String(init?.body)).toBe('{}')

      return new Response(JSON.stringify({
        ResponseMetadata: { RequestId: 'req' },
        Result: {
          Speakers: [{
            Speaker: 'zh_female_rock_mars_bigtts',
            Name: '摇滚女声',
            Language: 'zh',
            Gender: 'female',
            Scenario: '摇滚',
            Tags: ['rock', 'energetic'],
            ResourceId: 'seed-tts-2.0',
          }, {
            SpeakerID: 'en_male_product_demo_bigtts',
            DisplayName: 'Product Demo Male',
            Lang: 'en',
            Gender: 'male',
            Description: 'Clear English product narration',
          }],
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const catalog = await listVolcengineTtsVoices({ forceRefresh: true, allowFallback: false })

    expect(catalog.source).toBe('openapi')
    expect(catalog.voices).toHaveLength(2)
    expect(catalog.voices[0]).toMatchObject({
      id: 'zh_female_rock_mars_bigtts',
      name: '摇滚女声',
      language: 'zh',
      gender: 'female',
      scenario: '摇滚',
      resourceId: 'seed-tts-1.0',
    })
    expect(catalog.voices[0].styles).toContain('rock')
    expect(catalog.voices[1]).toMatchObject({
      id: 'en_male_product_demo_bigtts',
      name: 'Product Demo Male',
      language: 'en',
    })
  })

  it('falls back to a small voice list when OpenAPI AK/SK is not configured', async () => {
    vi.stubEnv('VOLCENGINE_ACCESS_KEY_ID', '')
    vi.stubEnv('VOLCENGINE_SECRET_ACCESS_KEY', '')

    const catalog = await listVolcengineTtsVoices({ forceRefresh: true, allowFallback: true })

    expect(catalog.source).toBe('fallback')
    expect(catalog.warning).toContain('Missing Volcengine OpenAPI')
    expect(catalog.voices.length).toBeGreaterThan(0)
  })
})
