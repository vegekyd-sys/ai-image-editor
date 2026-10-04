import { normalizeLocale } from '@/lib/locales'

export type TipsCategory = 'enhance' | 'creative' | 'wild' | 'captions'

const EN_PROMPT_TEMPLATES: Record<TipsCategory, string> = {
  enhance: `Choose two clearly different, immediately visible improvements grounded in this photo. Prefer scene-specific lighting, weather, depth, color, or material refinements over repeatedly suggesting generic cinematic light or golden hour. Keep identities, facial structure, hairstyle, expression, pose, framing, and important objects intact unless the direction explicitly requires a change. Each editPrompt must describe the complete edit in English.`,
  creative: `Choose two photo-specific ideas that feel delightful, funny, or story-rich. Every added element must have a clear reason to belong in this exact scene; reject random mascots, floating props, or generic effects that could fit any photo. Keep the emotional result warm and shareable, not frightening or confusing. Preserve identities and integrate new elements with believable scale, lighting, shadows, and depth. Each editPrompt must describe the complete edit in English.`,
  wild: `Choose two bold, shareable transformations centered on something already visible in the photo. Make the transformation obvious at a glance through scale, function, material, or a 2D-to-3D change. Do not merely add a random object, swap the whole background, or suggest a subtle color change. Preserve recognizable people and the scene's key composition while making the transformed element visually coherent. Each editPrompt must describe the complete edit in English.`,
  captions: `Choose two distinct typography concepts that turn the photo into a designed visual piece. First inspect any existing signs, logos, watermarks, or text and decide whether to preserve, remove, or creatively replace them. Make the wording specific to the scene and integrate typography with subject placement, hierarchy, contrast, and negative space. Avoid covering faces or important objects. Each editPrompt must describe the complete edit in English, including the exact text to render.`,
}

export function getTipsPromptTemplate(
  category: TipsCategory,
  locale: string | undefined,
  chineseTemplate: string,
): string {
  return normalizeLocale(locale) === 'en' ? EN_PROMPT_TEMPLATES[category] : chineseTemplate
}
