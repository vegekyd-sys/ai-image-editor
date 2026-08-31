import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createToken: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    authTokens = { create: mocks.createToken }
  },
  Modality: { AUDIO: 'AUDIO' },
  ThinkingLevel: { MINIMAL: 'MINIMAL' },
}))

import { POST } from '@/app/api/kids/live-token/route'

describe('Makaron Kids Live token route', () => {
  const originalKey = process.env.GOOGLE_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GOOGLE_API_KEY = 'server-only-key'
    mocks.createToken.mockResolvedValue({ name: 'ephemeral-token' })
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = originalKey
  })

  it('does not provision a provider token when app authentication fails', async () => {
    mocks.authenticateRequest.mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) })

    const response = await POST(new Request('http://localhost/api/kids/live-token', { method: 'POST' }))

    expect(response.status).toBe(401)
    expect(mocks.createToken).not.toHaveBeenCalled()
  })

  it('locks a one-use token to the Live model, audio, voice, safety prompt, and image tool', async () => {
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1', supabase: {} } })
    const before = Date.now()

    const response = await POST(new Request('http://localhost/api/kids/live-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: 'not-allowed' }),
    }))
    const body = await response.json()
    const call = mocks.createToken.mock.calls[0][0].config

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body).toMatchObject({ token: 'ephemeral-token', model: 'gemini-3.1-flash-live-preview', voice: 'Kore' })
    expect(call.uses).toBe(1)
    expect(Date.parse(call.newSessionExpireTime)).toBeGreaterThanOrEqual(before + 59_000)
    expect(Date.parse(call.expireTime)).toBeGreaterThanOrEqual(before + 29 * 60_000)
    expect(call.liveConnectConstraints).toMatchObject({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: ['AUDIO'],
        sessionResumption: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        tools: [{ functionDeclarations: [{ name: 'queue_image_request' }] }],
      },
    })
    expect(call.liveConnectConstraints.config.systemInstruction).toContain('never ask for personal details')
    expect(call.liveConnectConstraints.config.systemInstruction).toContain('trusted grown-up')
    expect(call.liveConnectConstraints.config.contextWindowCompression).toEqual({
      triggerTokens: '12000', slidingWindow: { targetTokens: '6000' },
    })
    expect(call.liveConnectConstraints.config.tools[0].functionDeclarations[0].behavior).toBeUndefined()
  })
})
