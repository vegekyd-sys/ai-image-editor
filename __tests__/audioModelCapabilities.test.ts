import { describe, expect, it } from 'vitest'
import {
  formatAudioCapabilitiesForAgent,
  getAudioModelCapability,
  normalizeAudioModelId,
  validateAudioRequest,
} from '@/lib/audio-model-capabilities'

describe('audio model capabilities', () => {
  it('defaults generic audio generation to EvoLink Seed Audio', () => {
    expect(normalizeAudioModelId()).toBe('evolink-seed-audio')
    expect(normalizeAudioModelId('auto')).toBe('evolink-seed-audio')
    expect(normalizeAudioModelId('doubao-seed-audio-1-0')).toBe('evolink-seed-audio')
    expect(normalizeAudioModelId('suno')).toBe('evolink-seed-audio')

    expect(getAudioModelCapability()).toMatchObject({
      id: 'evolink-seed-audio',
      provider: 'evolink',
      providerModel: 'doubao-seed-audio-1-0',
      maxDurationSeconds: 120,
      defaultFormat: 'mp3',
    })
  })

  it('keeps audio capability notes prompt-first instead of hard category flags', () => {
    const capability = getAudioModelCapability('evolink-seed-audio')
    expect(Object.keys(capability).some(key => key.startsWith('supports'))).toBe(false)
    expect(capability.notes.join(' ')).toContain('Prompt can describe music, sound effects, ambience, character voice, or mixed sound design')
  })

  it('validates only hard duration limits', () => {
    expect(validateAudioRequest({ model: 'evolink-seed-audio', durationSeconds: 120 })).toBeNull()
    expect(validateAudioRequest({ model: 'evolink-seed-audio', durationSeconds: 121 })).toContain('120 seconds or less')
  })

  it('formats a compact capability card for the agent', () => {
    const text = formatAudioCapabilitiesForAgent()
    expect(text).toContain('evolink-seed-audio')
    expect(text).toContain('volcengine-seed-tts')
    expect(text).toContain('Use the dedicated generate_voiceover tool')
    expect(text).not.toContain('Suno')
  })
})
