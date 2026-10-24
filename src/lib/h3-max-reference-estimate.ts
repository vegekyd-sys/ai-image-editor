/** Research/seed estimate only; live billing uses the media-pricing rate card.
 * Video examples use 37,296 tokens per 5s at 768p.
 * Rechecked 2026-10-23: 1080p reference videos use the same rate as 768p.
 */
export function estimateH3MaxReferenceInput(input: {
  imageTokens: number
  videoSeconds: number
  audioSeconds: number
  resolution: string
}) {
  const referenceTokens = input.imageTokens
    + input.videoSeconds * (input.resolution === '480p' ? 2886 : 37296 / 5)
    + input.audioSeconds * 80
  const referenceUsd = Math.max(0, referenceTokens - 4096) * 0.02 / 1000
  return { referenceTokens, referenceUsd }
}
