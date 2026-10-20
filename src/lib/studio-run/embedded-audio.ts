interface VideoAsset { id: string; type: string; path: string; hasAudio?: boolean }

/** Verify claimed video audio once at the Assets boundary. Track presence is
 * transport evidence only; intelligibility and sync still need final review.
 */
export async function assertEmbeddedAudioAssets(input: {
  assets: VideoAsset[];
  probe: (path: string) => Promise<{ hasAudio?: boolean } | null>;
}): Promise<void> {
  for (const asset of input.assets.filter(asset => asset.type === 'video' && asset.hasAudio === true)) {
    const measured = await input.probe(asset.path);
    if (measured?.hasAudio !== true) {
      throw new Error(`Video asset ${asset.id} has no verified embedded audio track. Inspect the existing video; do not claim it is an audible final or generate a replacement soundtrack merely to satisfy the manifest.`);
    }
  }
}
