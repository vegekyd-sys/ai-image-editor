import type { AudioGenerationKind } from './skills/create-audio'

const VOICE_PATTERN = /\b(?:voice[\s-]?over|vo|narration|narrator|spoken|speech|dialogue)\b|旁白|解说|配音|人声|对白|台词/i
const SUPPORTING_AUDIO_PATTERN = /\b(?:music|soundtrack|score|bgm|ambience|ambient|sound[\s-]?effects?|sfx|foley)\b|配乐|背景音乐|音乐|氛围音|环境音|音效/i
const ISOLATED_VOICE_PATTERN = /\b(?:voice[\s-]?only|dry voice|isolated voice|no music|without music|no soundtrack|without soundtrack|no sfx|without sfx)\b|纯旁白|仅旁白|只要旁白|只生成人声|干声|不要音乐|不需要音乐|无配乐|不要音效/i
const NO_VOICE_PATTERN = /\b(?:music[\s-]?only|instrumental only|no voice|without voice|no narration|without narration|no dialogue|without dialogue)\b|纯音乐|仅音乐|不要旁白|无需旁白|无人声|不要人声|无对白/i
const IMAGE_CONDITIONING_PATTERN = /\b(?:image[-\s]?(?:conditioned|guided)|reference image|image_ref|use (?:this|that|the) image)\b|看图|根据.{0,12}(?:图片|图像)|参考.{0,12}(?:图片|图像)|用.{0,12}(?:图片|图像).{0,12}(?:生成|制作|配音|声音|音频)/i
const NO_IMAGE_CONDITIONING_PATTERN = /\b(?:no|without|do not use|don't use)\s+(?:image[-\s]?conditioning|image_ref|reference image)\b|(?:不要|无需|不使用).{0,8}(?:image_ref|图片条件|图片参考|图像条件|图像参考)/i

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

/**
 * Optional image conditioning must come from the user request, never from the
 * currently selected Timeline media or a model-defaulted index.
 */
export function requestsImageConditionedAudio(request: string): boolean {
  const normalized = request.trim()
  if (NO_IMAGE_CONDITIONING_PATTERN.test(normalized)) return false
  return IMAGE_CONDITIONING_PATTERN.test(normalized)
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
