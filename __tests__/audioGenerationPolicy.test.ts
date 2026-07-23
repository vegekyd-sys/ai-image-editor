import { describe, expect, it } from 'vitest'
import {
  requiresUnifiedMixedAudio,
  validateAudioKindForRequest,
} from '../src/lib/audio-generation-policy'

describe('unified Seed Audio generation policy', () => {
  it('requires one mixed generation for voice plus supporting audio', () => {
    expect(requiresUnifiedMixedAudio('做一个有情绪旁白和背景音乐的 30 秒 explainer video')).toBe(true)
    expect(requiresUnifiedMixedAudio('Create narration with music, ambience, and UI sound effects')).toBe(true)
    expect(validateAudioKindForRequest('旁白加配乐一次生成', 'voiceover')).toContain('exactly one Seed Audio model generation')
    expect(validateAudioKindForRequest('旁白加配乐一次生成', 'music')).toContain('kind="mixed"')
    expect(validateAudioKindForRequest('旁白加配乐一次生成', 'mixed')).toBeUndefined()
  })

  it('preserves explicit isolated-voice and music-only requests', () => {
    expect(requiresUnifiedMixedAudio('只要纯旁白，不需要音乐和音效')).toBe(false)
    expect(requiresUnifiedMixedAudio('voice-only narration without music')).toBe(false)
    expect(requiresUnifiedMixedAudio('instrumental only, no voiceover')).toBe(false)
    expect(validateAudioKindForRequest('纯旁白', 'voiceover')).toBeUndefined()
  })
})
