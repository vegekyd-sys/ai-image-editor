import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
}))

vi.mock('@/lib/evolink-seed-audio', () => ({
  generateWithEvolinkSeedAudio: mocks.generate,
}))

import { createAudio } from '@/lib/skills/create-audio'

describe('createAudio same-speaker translation', () => {
  beforeEach(() => {
    mocks.generate.mockReset()
    mocks.generate.mockResolvedValue({
      taskId: 'translation-1',
      provider: 'evolink',
      model: 'doubao-seed-audio-1-0',
      status: 'completed',
      audioUrl: 'https://example.com/translated.wav',
      duration: 14,
      format: 'wav',
      generationSeconds: 20,
    })
  })

  it('builds direct translation from one MP3 reference', async () => {
    const result = await createAudio({
      kind: 'translation',
      targetLanguage: 'English',
      audioReferences: ['https://example.com/source.mp3'],
      durationSeconds: 14,
    })

    expect(result.success).toBe(true)
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      audioReferences: ['https://example.com/source.mp3'],
      format: 'wav',
      sampleRate: 48000,
    }))
    const prompt = mocks.generate.mock.calls[0][0].prompt
    expect(prompt).toContain('Mode: direct speech translation.')
    expect(prompt).toContain('Target language: English.')
    expect(prompt).toContain('Translate all spoken content in @audio1')
    expect(prompt).toContain('Preserve the same speaker identity')
    expect(prompt).toContain('Voice only.')
  })

  it('locks exact translated wording when supplied', async () => {
    await createAudio({
      kind: 'translation',
      targetLanguage: 'English',
      translatedScript: 'Of course. That is our core strength.',
      audioReferences: ['https://example.com/source.wav'],
    })

    expect(mocks.generate.mock.calls[0][0].prompt).toContain(
      'Speak this translated script exactly, without additions or omissions: "Of course. That is our core strength."',
    )
  })

  it('requires one source reference and a target language', async () => {
    await expect(createAudio({ kind: 'translation', audioReferences: ['https://example.com/source.mp3'] }))
      .resolves.toMatchObject({ success: false, message: 'targetLanguage is required for speech translation.' })
    await expect(createAudio({ kind: 'translation', targetLanguage: 'English' }))
      .resolves.toMatchObject({ success: false, message: 'Speech translation requires exactly one source voice/audio reference.' })
  })
})
