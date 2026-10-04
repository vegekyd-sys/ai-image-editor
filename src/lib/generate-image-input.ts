/**
 * GPT-5.6 may serialize an omitted optional numeric tool argument as 0.
 * For generate_image, 0 is the provider sentinel for "no edit base", which
 * means pure text-to-image mode. Real timeline indices remain 1-based.
 */
export function normalizeGenerateImageMediaIndex(
  mediaIndex: number | undefined,
): number | undefined {
  return mediaIndex === 0 ? undefined : mediaIndex;
}
