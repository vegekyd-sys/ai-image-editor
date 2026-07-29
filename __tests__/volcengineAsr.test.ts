import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isAsrTranscriptCacheCompatible,
  transcribeWithVolcengineAsr,
  type VolcengineAsrTranscript,
} from '@/lib/volcengine-asr'

function cachedTranscript(requestedLanguage?: string): VolcengineAsrTranscript {
  return {
    provider: 'volcengine',
    model: 'bigmodel-flash',
    resourceId: 'test',
    requestId: 'cached-request',
    requestedLanguage,
    text: 'cached',
    durationMs: 1000,
    utterances: [],
    createdAt: '2026-07-29T00:00:00.000Z',
  }
}

describe('volcengine ASR client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('calls bigmodel flash ASR with API key credentials and parses timecodes', async () => {
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', 'test-api-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      const body = JSON.parse(String(init?.body))
      expect(headers['X-Api-Key']).toBe('test-api-key')
      expect(headers['X-Api-Resource-Id']).toBe('volc.bigasr.auc_turbo')
      expect(headers['X-Api-Request-Id']).toBe('req-1')
      expect(body.audio.url).toBe('https://cdn.example.com/audio.mp3')
      expect(body.audio.language).toBe('zh-CN')
      expect(body.request).toMatchObject({
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
      })
      expect(body).not.toHaveProperty('additions')

      return new Response(JSON.stringify({
        audio_info: { duration: 2499 },
        result: {
          text: '关闭透传。',
          utterances: [{
            start_time: 450,
            end_time: 1530,
            text: '关闭透传。',
            words: [
              { start_time: 450, end_time: 770, text: '关', confidence: 0.9 },
              { start_time: 770, end_time: 900, text: '闭', confidence: 0.8 },
            ],
          }],
        },
      }), {
        status: 200,
        headers: {
          'X-Api-Status-Code': '20000000',
          'X-Api-Message': 'OK',
          'X-Tt-Logid': 'volc-log-1',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const transcript = await transcribeWithVolcengineAsr({
      mediaUrl: 'https://cdn.example.com/audio.mp3',
      requestId: 'req-1',
      uid: 'user-1',
      language: 'zh-CN',
    })

    expect(transcript.text).toBe('关闭透传。')
    expect(transcript.durationMs).toBe(2499)
    expect(transcript.utterances[0].startMs).toBe(450)
    expect(transcript.utterances[0].words[0]).toMatchObject({ text: '关', startMs: 450, endMs: 770 })
    expect(transcript.extractedAudio).toBe(false)
    expect(transcript.requestedLanguage).toBe('zh-CN')
    expect(transcript.providerLogId).toBe('volc-log-1')
  })

  it('sends Japanese as audio.language so Volcengine selects the Japanese model', async () => {
    vi.stubEnv('VOLCENGINE_ASR_API_KEY', 'test-api-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.audio).toEqual({
        url: 'https://cdn.example.com/japanese.mp3',
        language: 'ja-JP',
      })
      expect(body.request).toEqual({
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
      })
      expect(body).not.toHaveProperty('additions')

      return new Response(JSON.stringify({
        audio_info: { duration: 1800 },
        result: {
          text: 'ちょっと待って。',
          utterances: [{
            start_time: 0,
            end_time: 1800,
            text: 'ちょっと待って。',
            words: [
              { start_time: 0, end_time: 500, text: 'ちょっと' },
              { start_time: 500, end_time: 1800, text: '待って' },
            ],
          }],
        },
      }), {
        status: 200,
        headers: {
          'X-Api-Status-Code': '20000000',
          'X-Tt-Logid': 'volc-ja-log',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeWithVolcengineAsr({
      mediaUrl: 'https://cdn.example.com/japanese.mp3',
      requestId: 'req-ja',
      language: 'ja-JP',
    })).resolves.toMatchObject({
      text: 'ちょっと待って。',
      requestedLanguage: 'ja-JP',
      providerLogId: 'volc-ja-log',
    })
  })

  it('supports legacy app key and access key headers', async () => {
    vi.stubEnv('VOLCENGINE_ASR_APP_KEY', 'legacy-app')
    vi.stubEnv('VOLCENGINE_ASR_ACCESS_KEY', 'legacy-access')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers['X-Api-App-Key']).toBe('legacy-app')
      expect(headers['X-Api-Access-Key']).toBe('legacy-access')
      return new Response(JSON.stringify({ result: { text: '', utterances: [] } }), {
        status: 200,
        headers: { 'X-Api-Status-Code': '20000000' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeWithVolcengineAsr({
      mediaUrl: 'https://cdn.example.com/audio.wav',
      requestId: 'req-2',
    })).resolves.toMatchObject({ requestId: 'req-2' })
  })

  it('fails clearly when ASR credentials are missing', async () => {
    await expect(transcribeWithVolcengineAsr({
      mediaUrl: 'https://cdn.example.com/audio.mp3',
      requestId: 'req-3',
    })).rejects.toThrow('Missing Volcengine ASR credentials')
  })

  it('does not reuse a transcript cached under a different or unknown language', () => {
    expect(isAsrTranscriptCacheCompatible(cachedTranscript('ja-JP'), 'ja-JP')).toBe(true)
    expect(isAsrTranscriptCacheCompatible(cachedTranscript('zh-CN'), 'ja-JP')).toBe(false)
    expect(isAsrTranscriptCacheCompatible(cachedTranscript(), 'ja-JP')).toBe(false)
    expect(isAsrTranscriptCacheCompatible(cachedTranscript('zh-CN'), undefined)).toBe(true)
  })
})
