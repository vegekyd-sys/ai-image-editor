import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateWithEvolinkSeedAudio } from '@/lib/evolink-seed-audio'
import { createAudio } from '@/lib/skills/create-audio'

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
        expect(body.audio_references).toEqual(['https://example.com/source-voice.mp3'])
        expect(body.speech_rate).toBe(0.92)
        expect(body.loudness_rate).toBe(1.08)
        expect(body.pitch_rate).toBe(-1)
        expect(body.format).toBe('wav')
        expect(body.sample_rate).toBe(48000)
        expect(body.callback_url).toBe('https://example.com/audio-callback')
        return new Response(JSON.stringify({ id: 'task-audio-1' }), { status: 200 })
      }
      if (url.endsWith('/v1/tasks/task-audio-1')) {
        return new Response(JSON.stringify({
          status: 'completed',
          result_data: [{ audio_url: 'https://example.com/audio.wav', duration: 8, format: 'wav' }],
          usage: { credits_used: 1.36 },
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateWithEvolinkSeedAudio({
      prompt: '@audio1 reads one short line over clean keyboard typing.',
      durationSeconds: 8,
      audioReferences: ['https://example.com/source-voice.mp3'],
      speechRate: 0.92,
      loudnessRate: 1.08,
      pitchRate: -1,
      callbackUrl: 'https://example.com/audio-callback',
    })

    expect(result).toMatchObject({
      taskId: 'task-audio-1',
      provider: 'evolink',
      model: 'doubao-seed-audio-1-0',
      audioUrl: 'https://example.com/audio.wav',
      duration: 8,
      format: 'wav',
      creditsUsed: 1.36,
    })
  })

  it('preserves a valid maximum-length mixed brief and its duration in the gateway request', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    vi.stubEnv('EVOLINK_SEED_AUDIO_POLL_INTERVAL_MS', '1')
    const brief = 'Keep the spoken words clear over soft room tone. '.repeat(26).slice(0, 1250).trimEnd().padEnd(1250, '.')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/audios/generations')) {
        const { prompt } = JSON.parse(String(init?.body))
        expect(prompt.length).toBeLessThanOrEqual(1500)
        expect(prompt).toMatch(/30 seconds/)
        expect(prompt).toContain('Mode: one-pass unified finished soundtrack.')
        expect(prompt.endsWith(brief)).toBe(true)
        return Response.json({ id: 'mixed-audio-task' })
      }
      expect(url).toMatch(/\/v1\/tasks\/mixed-audio-task$/)
      return Response.json({
        status: 'completed',
        result_data: [{ audio_url: 'https://example.com/mixed.wav', duration: 30, format: 'wav' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAudio({ kind: 'mixed', prompt: brief, durationSeconds: 30 }))
      .resolves.toMatchObject({ success: true, audioUrl: 'https://example.com/mixed.wav' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails fast when duration exceeds Seed Audio limit', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    await expect(generateWithEvolinkSeedAudio({
      prompt: 'Long ambience.',
      durationSeconds: 121,
    })).rejects.toThrow('120 seconds or less')
  })

  it('rejects invalid reference, image, and quality-control combinations before submit', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateWithEvolinkSeedAudio({
      prompt: '@audio1 speaks.',
      audioReferences: ['voice-a'],
      imageUrls: ['https://example.com/reference.png'],
    })).rejects.toThrow('mutually exclusive')

    await expect(generateWithEvolinkSeedAudio({
      prompt: 'Missing reference marker.',
      audioReferences: ['voice-a'],
    })).rejects.toThrow('as @audio1')

    await expect(generateWithEvolinkSeedAudio({
      prompt: 'Invalid pitch.',
      pitchRate: 1.5,
    })).rejects.toThrow('integer number of semitones')

    await expect(generateWithEvolinkSeedAudio({
      prompt: 'Invalid sample rate.',
      sampleRate: 44100,
    })).rejects.toThrow('8000, 16000, 24000, or 48000')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the current 1,500-character gateway prompt boundary', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'sk-test')
    await expect(generateWithEvolinkSeedAudio({
      prompt: 'x'.repeat(1501),
    })).rejects.toThrow('1500 characters or less')
  })
})
