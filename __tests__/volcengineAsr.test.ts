import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeWithVolcengineAsr } from '@/lib/volcengine-asr'

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
      expect(body.request.model_name).toBe('bigmodel')
      expect(JSON.parse(body.additions)).toMatchObject({ use_itn: 'True', use_punc: 'True', language: 'zh-CN' })

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
        headers: { 'X-Api-Status-Code': '20000000', 'X-Api-Message': 'OK' },
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
})
