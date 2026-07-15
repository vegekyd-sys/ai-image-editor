import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateWithEvolinkSeedAudio } from '@/lib/evolink-seed-audio'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('EvoLink Seed Audio client', () => {
  it('submits, polls, and returns completed audio metadata', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    vi.stubEnv('EVOLINK_SEED_AUDIO_POLL_INTERVAL_MS', '1')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/audios/generations')) {
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
        const body = JSON.parse(String(init?.body))
        expect(body.model).toBe('doubao-seed-audio-1-0')
        expect(body.prompt).toContain('Generate about 8 seconds of audio.')
        return new Response(JSON.stringify({ id: 'task-audio-1' }), { status: 200 })
      }
      if (url.endsWith('/v1/tasks/task-audio-1')) {
        return new Response(JSON.stringify({
          status: 'completed',
          result_data: [{ audio_url: 'https://example.com/audio.mp3', duration: 8, format: 'mp3' }],
          usage: { credits_used: 1.36 },
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateWithEvolinkSeedAudio({
      prompt: 'Clean keyboard typing sound.',
      durationSeconds: 8,
    })

    expect(result).toMatchObject({
      taskId: 'task-audio-1',
      provider: 'evolink',
      model: 'doubao-seed-audio-1-0',
      audioUrl: 'https://example.com/audio.mp3',
      duration: 8,
      creditsUsed: 1.36,
    })
  })

  it('fails fast when duration exceeds Seed Audio limit', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    await expect(generateWithEvolinkSeedAudio({
      prompt: 'Long ambience.',
      durationSeconds: 121,
    })).rejects.toThrow('120 seconds or less')
  })
})
