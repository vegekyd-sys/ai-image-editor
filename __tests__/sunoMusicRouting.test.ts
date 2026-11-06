import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  seed: vi.fn(),
  suno: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/evolink-seed-audio', () => ({ generateWithEvolinkSeedAudio: mocks.seed }))
vi.mock('@/lib/supabase/storage', () => ({ uploadAudio: mocks.upload }))
vi.mock('@/lib/sunoapi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sunoapi')>()
  return { ...actual, generateSunoMusic: mocks.suno }
})

import { resolveAudioRoute, validateAudioRequest } from '@/lib/audio-model-capabilities'
import { buildSunoGenerateBody, mapSunoRecord } from '@/lib/sunoapi'
import { createAudio } from '@/lib/skills/create-audio'
import { formatGeneratedAudioForCui } from '@/lib/agent-tools'

const seedResult = {
  taskId: 'task-unified-seed-1',
  provider: 'evolink',
  model: 'doubao-seed-audio-1-0',
  status: 'completed',
  audioUrl: 'https://provider.example/seed.wav',
  duration: 30,
  format: 'wav',
  creditsUsed: 5.1,
  generationSeconds: 28,
}

const sunoResult = {
  taskId: 'c0ffee00c0ffee00c0ffee00c0ffee00',
  provider: 'sunoapi',
  model: 'V6',
  generationSeconds: 26,
  takes: [
    { audioUrl: 'https://tempfile.aiquickdraw.com/r/a.mp3', streamAudioUrl: 'https://audiostream.api.box/stream/a', duration: 29.6, title: 'Bed', tags: '' },
    { audioUrl: 'https://tempfile.aiquickdraw.com/r/b.mp3', streamAudioUrl: 'https://audiostream.api.box/stream/b', duration: 30.4, title: 'Bed', tags: '' },
  ],
}

function fakeSupabase(lastTrackIndex: number | null) {
  const upserts: Record<string, unknown>[] = []
  const client = {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: lastTrackIndex == null ? [] : [{ track_index: lastTrackIndex }], error: null }) }) }) }),
      upsert: vi.fn(async (row: Record<string, unknown>) => { upserts.push(row); return { error: null } }),
    })),
  }
  return { client, upserts }
}

describe('audio routing: only instrumental BGM leaves Seed Audio', () => {
  const originalKey = process.env.SUNOAPI_KEY
  beforeEach(() => { process.env.SUNOAPI_KEY = 'test-key' })
  afterEach(() => { process.env.SUNOAPI_KEY = originalKey })

  it('routes instrumental kind=music to Suno V6 with a Seed Audio fallback', () => {
    expect(resolveAudioRoute({ kind: 'music' })).toMatchObject({ modelId: 'suno-v6', fallbackModelId: 'evolink-seed-audio' })
    expect(resolveAudioRoute({ kind: 'music', instrumental: true, model: 'auto' })).toMatchObject({ modelId: 'suno-v6' })
  })

  it.each([
    ['voiceover', {}],
    ['dialogue', {}],
    ['mixed', {}],
    ['sound_design', {}],
    ['translation', { audioReferenceCount: 1 }],
    ['music', { instrumental: false }],
    ['music', { audioReferenceCount: 1 }],
    ['music', { imageReferenceCount: 1 }],
    [undefined, {}],
  ] as const)('keeps %s %o on the Seed Audio default', (kind, extra) => {
    expect(resolveAudioRoute({ kind, ...extra })).toMatchObject({ modelId: 'evolink-seed-audio' })
  })

  it('honors an explicit Seed Audio request for music', () => {
    expect(resolveAudioRoute({ kind: 'music', model: 'evolink-seed-audio' })).toMatchObject({ modelId: 'evolink-seed-audio' })
  })

  it('rejects an explicit Suno request outside instrumental BGM', () => {
    expect(resolveAudioRoute({ kind: 'mixed', model: 'suno-v6' })).toHaveProperty('error')
    expect(resolveAudioRoute({ kind: 'music', instrumental: false, model: 'suno' })).toHaveProperty('error')
  })

  it('stays on Seed Audio when Suno is not configured', () => {
    delete process.env.SUNOAPI_KEY
    expect(resolveAudioRoute({ kind: 'music' })).toMatchObject({ modelId: 'evolink-seed-audio' })
  })

  it('applies per-model duration limits', () => {
    expect(validateAudioRequest({ model: 'suno-v6', durationSeconds: 360 })).toBeNull()
    expect(validateAudioRequest({ model: 'suno-v6', durationSeconds: 5 })).toContain('at least 10 seconds')
    expect(validateAudioRequest({ model: 'evolink-seed-audio', durationSeconds: 180 })).toContain('120 seconds or less')
  })
})

describe('sunoapi adapter', () => {
  it('builds an instrumental V6 custom-mode request with duration', () => {
    expect(buildSunoGenerateBody({ style: 'lo-fi house, 110 BPM', title: 'Trip', durationSeconds: 30.4 })).toMatchObject({
      customMode: true,
      instrumental: true,
      model: 'V6',
      style: 'lo-fi house, 110 BPM',
      title: 'Trip',
      duration: 30,
      prompt: '',
    })
    expect(() => buildSunoGenerateBody({ style: 'x'.repeat(1001) })).toThrow('1000 characters')
    expect(() => buildSunoGenerateBody({ style: 'ok', durationSeconds: 400 })).toThrow('between 10 and 360')
  })

  it('waits for SUCCESS before treating takes as final', () => {
    const sunoData = [{ id: 'a', audioUrl: 'https://x/a.mp3', streamAudioUrl: 'https://s/a', duration: 29.6, title: 'T' }, { id: 'b', audioUrl: '', streamAudioUrl: 'https://s/b' }]
    expect(mapSunoRecord('t1', { status: 'FIRST_SUCCESS', response: { sunoData } }).status).toBe('streaming')
    const done = mapSunoRecord('t1', { status: 'SUCCESS', response: { sunoData: [sunoData[0], { ...sunoData[1], audioUrl: 'https://x/b.mp3' }] } })
    expect(done.status).toBe('completed')
    expect(done.takes.map(take => take.audioUrl)).toEqual(['https://x/a.mp3', 'https://x/b.mp3'])
    expect(mapSunoRecord('t1', { status: 'SENSITIVE_WORD_ERROR', errorMessage: 'blocked' })).toMatchObject({ status: 'failed', error: 'blocked' })
  })
})

describe('createAudio provider dispatch and takes', () => {
  const originalKey = process.env.SUNOAPI_KEY
  beforeEach(() => {
    process.env.SUNOAPI_KEY = 'test-key'
    mocks.seed.mockReset().mockResolvedValue(seedResult)
    mocks.suno.mockReset().mockResolvedValue(sunoResult)
    mocks.upload.mockReset().mockImplementation(async (_s, _u, _p, taskId, trackIndex, _b, format) => `https://cdn.example/${taskId}-${trackIndex}.${format}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
  })
  afterEach(() => {
    process.env.SUNOAPI_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('generates instrumental BGM with Suno and persists every take as its own track', async () => {
    const { client, upserts } = fakeSupabase(4)
    const result = await createAudio({ kind: 'music', prompt: 'lo-fi house, 110 BPM', durationSeconds: 30, title: 'Trip bed', supabase: client as any, userId: 'u1', projectId: 'p1' })

    expect(mocks.seed).not.toHaveBeenCalled()
    expect(mocks.suno).toHaveBeenCalledWith({ style: 'lo-fi house, 110 BPM', title: 'Trip bed', durationSeconds: 30 })
    expect(result).toMatchObject({
      success: true,
      model: 'suno-v6',
      provider: 'sunoapi',
      audioUrl: `https://cdn.example/${sunoResult.taskId}-5.mp3`,
      trackIndex: 5,
      billing: { provider: 'sunoapi', model: 'suno-v6', generations: 1 },
    })
    expect(result.takes?.map(take => [take.trackIndex, take.title, take.audioUrl, take.providerAudioUrl])).toEqual([
      [5, 'Trip bed · take 1', `https://cdn.example/${sunoResult.taskId}-5.mp3`, sunoResult.takes[0].audioUrl],
      [6, 'Trip bed · take 2', `https://cdn.example/${sunoResult.taskId}-6.mp3`, sunoResult.takes[1].audioUrl],
    ])
    expect(upserts.map(row => [row.suno_task_id, row.track_index, row.stream_audio_url, row.tags])).toEqual([
      [sunoResult.taskId, 5, sunoResult.takes[0].streamAudioUrl, expect.stringContaining('take:1/2')],
      [sunoResult.taskId, 6, sunoResult.takes[1].streamAudioUrl, expect.stringContaining('take:2/2')],
    ])
    expect(result.message).toContain('take 1 is the default')
  })

  it('falls back to Seed Audio instrumental music when Suno fails', async () => {
    mocks.suno.mockRejectedValueOnce(new Error('Suno generation failed: upstream'))
    const result = await createAudio({ kind: 'music', prompt: 'gentle piano', durationSeconds: 30 })

    expect(mocks.seed).toHaveBeenCalledTimes(1)
    expect(mocks.seed.mock.calls[0][0].prompt).toContain('Instrumental background music only, no vocals or lyrics.')
    expect(result).toMatchObject({ success: true, model: 'evolink-seed-audio', fallbackFrom: 'suno-v6', billing: { provider: 'evolink' } })
    expect(result.takes).toHaveLength(1)
  })

  it('does not fall back past the Seed Audio duration limit', async () => {
    mocks.suno.mockRejectedValueOnce(new Error('upstream down'))
    const result = await createAudio({ kind: 'music', prompt: 'ambient drone', durationSeconds: 200 })
    expect(result.success).toBe(false)
    expect(result.message).toContain('Suno V6: upstream down')
    expect(mocks.seed).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'mixed' as const, prompt: '[VOICE] hello [MUSIC] bed' }],
    [{ kind: 'voiceover' as const, prompt: 'Narrate the intro.' }],
    [{ kind: 'music' as const, prompt: 'pop song with lyrics', instrumental: false }],
    [{ kind: 'music' as const, prompt: 'continue @audio1', audioReferences: ['https://x/ref.mp3'] }],
  ])('keeps %o on Seed Audio', async (input) => {
    const result = await createAudio(input)
    expect(mocks.suno).not.toHaveBeenCalled()
    expect(mocks.seed).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, model: 'evolink-seed-audio', billing: { provider: 'evolink', providerCreditsUsed: 5.1 } })
    expect(result.takes).toHaveLength(1)
  })

  it('rejects an over-long Suno brief instead of silently switching provider', async () => {
    const result = await createAudio({ kind: 'music', prompt: 'x'.repeat(1100) })
    expect(result.success).toBe(false)
    expect(result.message).toContain('1000-character Suno V6 prompt limit')
    expect(mocks.suno).not.toHaveBeenCalled()
    expect(mocks.seed).not.toHaveBeenCalled()
  })
})

describe('CUI cards for multi-take audio', () => {
  it('renders one selectable card per take with the permanent URL', () => {
    const text = formatGeneratedAudioForCui('generate_audio', {
      success: true,
      takes: [
        { audioUrl: 'https://cdn.example/a.mp3', providerAudioUrl: 'https://tmp/a.mp3', streamAudioUrl: 'https://stream/a', duration: 29.6, title: 'Bed · take 1', tags: 'audio,music', trackIndex: 5 },
        { audioUrl: 'https://cdn.example/b.mp3', providerAudioUrl: 'https://tmp/b.mp3', duration: 30.4, title: 'Bed · take 2', tags: 'audio,music', trackIndex: 6 },
      ],
    })
    expect(text).toContain('music:5|Bed · take 1|30|audio,music|https://cdn.example/a.mp3|https://cdn.example/a.mp3')
    expect(text).toContain('music:6|Bed · take 2|30|audio,music|https://cdn.example/b.mp3|https://cdn.example/b.mp3')
    expect(text).not.toContain('https://stream/a')
    expect(text).not.toContain('https://tmp/')
  })

  it('keeps a single-take result as one named card', () => {
    const text = formatGeneratedAudioForCui('generate_audio', {
      success: true,
      title: 'Generated voiceover',
      audioUrl: 'https://cdn.example/v.wav',
      duration: 12,
      trackIndex: 2,
      takes: [{ audioUrl: 'https://cdn.example/v.wav', providerAudioUrl: 'https://tmp/v.wav', duration: 12, title: 'Generated voiceover', tags: '', trackIndex: 2 }],
    })
    expect(text?.match(/music:/g)).toHaveLength(1)
    expect(text).toContain('https://cdn.example/v.wav')
  })
})
