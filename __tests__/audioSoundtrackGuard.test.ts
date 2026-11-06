import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAudio: vi.fn() }))
vi.mock('@/lib/skills/create-audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/skills/create-audio')>()
  return { ...actual, createAudio: mocks.createAudio }
})
vi.mock('@/lib/billing/audio', () => ({ deductAudioCredits: vi.fn(async () => ({ charged: 0, remaining: 0 })) }))

import { findSplitSoundtrackConflict, parseGeneratedAudioTags } from '@/lib/audio-soundtrack-guard'
import { createTools } from '@/lib/agent-tools'

describe('split-soundtrack guard', () => {
  it('reads kind and run from project_music tags', () => {
    expect(parseGeneratedAudioTags('audio,seed-audio,kind:voiceover,evolink-seed-audio,run:run-1')).toEqual({ kind: 'voiceover', runId: 'run-1' })
    expect(parseGeneratedAudioTags('reference,audio,cli')).toEqual({})
    expect(parseGeneratedAudioTags(null)).toEqual({})
  })

  it.each(['voiceover', 'dialogue', 'mixed'])('blocks a music bed after %s in the same run', (existingKind) => {
    const message = findSplitSoundtrackConflict({ kind: 'music', runId: 'run-1', existing: [{ kind: existingKind, runId: 'run-1', label: '<<<audio_1>>>' }] })
    expect(message).toContain('ONE generate_audio call with kind="mixed"')
    expect(message).toContain(`<<<audio_1>>> (${existingKind})`)
  })

  it.each(['music', 'mixed'])('blocks separate speech after %s in the same run', (existingKind) => {
    expect(findSplitSoundtrackConflict({ kind: 'voiceover', runId: 'run-1', existing: [{ kind: existingKind, runId: 'run-1' }] })).toContain('Blocked: this run already generated music')
    expect(findSplitSoundtrackConflict({ kind: 'dialogue', runId: 'run-1', existing: [{ kind: existingKind, runId: 'run-1' }] })).toContain('kind="mixed"')
  })

  it('always allows the single mixed generation and unrelated runs', () => {
    expect(findSplitSoundtrackConflict({ kind: 'mixed', runId: 'run-1', existing: [{ kind: 'voiceover', runId: 'run-1' }, { kind: 'music', runId: 'run-1' }] })).toBeNull()
    expect(findSplitSoundtrackConflict({ kind: 'music', runId: 'run-2', existing: [{ kind: 'voiceover', runId: 'run-1' }] })).toBeNull()
    expect(findSplitSoundtrackConflict({ kind: 'music', runId: 'run-1', existing: [{ kind: 'music', runId: 'run-1' }, { kind: 'sound_design', runId: 'run-1' }] })).toBeNull()
    expect(findSplitSoundtrackConflict({ kind: 'translation', runId: 'run-1', existing: [{ kind: 'music', runId: 'run-1' }] })).toBeNull()
    expect(findSplitSoundtrackConflict({ kind: 'music', runId: undefined, existing: [{ kind: 'voiceover', runId: 'run-1' }] })).toBeNull()
  })
})

describe('generate_audio enforces one mixed soundtrack per deliverable', () => {
  beforeEach(() => {
    mocks.createAudio.mockReset().mockImplementation(async (input: { kind: string }) => ({
      success: true,
      message: 'Audio generated.',
      taskId: `task-${input.kind}`,
      model: input.kind === 'music' ? 'suno-v6' : 'evolink-seed-audio',
      audioUrl: `https://cdn.example/${input.kind}.mp3`,
      duration: 20,
      takes: [{ audioUrl: `https://cdn.example/${input.kind}.mp3`, providerAudioUrl: `https://tmp/${input.kind}.mp3`, duration: 20, title: input.kind, tags: '', trackIndex: 0 }],
      billing: { provider: 'evolink', model: 'evolink-seed-audio', durationSeconds: 20 },
    }))
  })

  function generateAudio(ctx: Record<string, unknown>) {
    return createTools(ctx as any, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_audio.execute as any
  }

  it('rejects a Suno bed after a voiceover in the same run without calling a provider', async () => {
    const ctx = { userId: 'u1', projectId: 'p1', supabase: {}, snapshotImages: [], explicitMediaIndices: [], agentRunId: 'run-1', audioAttachments: [] }
    const execute = generateAudio(ctx)

    const voice = await execute({ kind: 'voiceover', prompt: 'Narrate: welcome to Kyoto.' })
    expect(voice.success).toBe(true)
    expect(mocks.createAudio).toHaveBeenCalledWith(expect.objectContaining({ kind: 'voiceover', runId: 'run-1' }))
    expect(ctx.audioAttachments).toEqual([expect.objectContaining({ kind: 'voiceover', runId: 'run-1' })])

    const music = await execute({ kind: 'music', prompt: 'soft piano bed', duration_seconds: 30 })
    expect(music.success).toBe(false)
    expect(music.message).toContain('kind="mixed"')
    expect(mocks.createAudio).toHaveBeenCalledTimes(1)

    const mixed = await execute({ kind: 'mixed', prompt: '[VOICE] welcome to Kyoto [MUSIC] soft piano' })
    expect(mixed.success).toBe(true)
    expect(mocks.createAudio).toHaveBeenCalledTimes(2)
  })

  it('uses restored project tags, so a durable retry of the same run is still guarded', async () => {
    const ctx = {
      userId: 'u1', projectId: 'p1', supabase: {}, snapshotImages: [], explicitMediaIndices: [], execution: { runId: 'run-9' },
      audioAttachments: [{ audioUrl: 'https://cdn.example/music.mp3', kind: 'music', runId: 'run-9' }],
    }
    const result = await generateAudio(ctx)({ kind: 'voiceover', prompt: 'Narrate the intro.' })
    expect(result.success).toBe(false)
    expect(mocks.createAudio).not.toHaveBeenCalled()
  })

  it('still lets a later run add music to an earlier project', async () => {
    const ctx = {
      userId: 'u1', projectId: 'p1', supabase: {}, snapshotImages: [], explicitMediaIndices: [], agentRunId: 'run-2',
      audioAttachments: [{ audioUrl: 'https://cdn.example/voice.wav', kind: 'voiceover', runId: 'run-1' }],
    }
    const result = await generateAudio(ctx)({ kind: 'music', prompt: 'lo-fi bed for a separate clip' })
    expect(result.success).toBe(true)
  })
})
