import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/volcengine-asr', () => ({ transcribeWithVolcengineAsr: mocks.transcribe }))
vi.mock('@/lib/volcengine-tts', () => ({ synthesizeWithVolcengineTts: mocks.synthesize }))

import { POST as transcribe } from '@/app/api/kids/transcribe/route'
import { POST as speak } from '@/app/api/kids/speak/route'

describe('Makaron Kids compatible voice routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'parent-1', supabase: {} } })
  })

  it('requires the parent session before ASR or TTS provider work', async () => {
    mocks.authenticateRequest.mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) })

    expect((await transcribe(new Request('http://localhost/api/kids/transcribe', { method: 'POST' }))).status).toBe(401)
    expect((await speak(new Request('http://localhost/api/kids/speak', { method: 'POST' }))).status).toBe(401)
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(mocks.synthesize).not.toHaveBeenCalled()
  })

  it('transcribes a bounded recording and returns only the child utterance', async () => {
    mocks.transcribe.mockResolvedValue({ text: '  画一只会飞的小猫。  ', durationMs: 1800 })
    const form = new FormData()
    form.append('audio', new File([new Uint8Array([1, 2, 3])], 'turn.webm', { type: 'audio/webm' }))

    const response = await transcribe(new Request('http://localhost/api/kids/transcribe', { method: 'POST', body: form }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: '画一只会飞的小猫。', durationMs: 1800 })
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      language: 'zh-CN', uid: 'parent-1', localMediaPath: expect.stringContaining('recording.webm'),
    }))
  })

  it('returns real audio bytes without exposing provider credentials', async () => {
    mocks.synthesize.mockResolvedValue({
      provider: 'volcengine',
      audio: new Uint8Array([73, 68, 51]),
    })
    const response = await speak(new Request('http://localhost/api/kids/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ' 好呀！ ' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('X-Kids-Voice-Provider')).toBe('volcengine')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([73, 68, 51])
    expect(mocks.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: '好呀！' }))
  })
})
