import type { AudioGenerationKind } from './skills/create-audio'

const VOICE_PATTERN = /\b(?:voice[\s-]?over|vo|narration|narrator|spoken|speech|dialogue)\b|旁白|解说|配音|人声|对白|台词/i
const SUPPORTING_AUDIO_PATTERN = /\b(?:music|soundtrack|score|bgm|ambience|ambient|sound[\s-]?effects?|sfx|foley)\b|配乐|背景音乐|音乐|氛围音|环境音|音效/i
const ISOLATED_VOICE_PATTERN = /\b(?:voice[\s-]?only|dry voice|isolated voice|no music|without music|no soundtrack|without soundtrack|no sfx|without sfx)\b|纯旁白|仅旁白|只要旁白|只生成人声|干声|不要音乐|不需要音乐|无配乐|不要音效/i
const NO_VOICE_PATTERN = /\b(?:music[\s-]?only|instrumental only|no voice|without voice|no narration|without narration|no dialogue|without dialogue)\b|纯音乐|仅音乐|不要旁白|无需旁白|无人声|不要人声|无对白/i

/**
 * Detects when one requested soundtrack contains both speech and supporting
 * audio. A non-mixed call can then be rejected before provider generation.
 */
export function requiresUnifiedMixedAudio(request: string): boolean {
  const normalized = request.trim()
  if (!normalized || ISOLATED_VOICE_PATTERN.test(normalized) || NO_VOICE_PATTERN.test(normalized)) {
    return false
  }
  return VOICE_PATTERN.test(normalized) && SUPPORTING_AUDIO_PATTERN.test(normalized)
}

export function validateAudioKindForRequest(
  request: string,
  kind: AudioGenerationKind,
): string | undefined {
  if (!requiresUnifiedMixedAudio(request) || kind === 'mixed') return
  return [
    'This request needs voice plus music/ambience/SFX in one finished soundtrack.',
    'Do not generate separate voiceover and supporting-audio assets.',
    'Make exactly one Seed Audio model generation with generate_audio kind="mixed" and put the complete spoken script, Voice Performance Brief, music, ambience, SFX, mix priorities, and audible timeline in that one prompt.',
  ].join(' ')
}
