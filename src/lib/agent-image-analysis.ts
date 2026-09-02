export interface ImageAnalysisRuntimeSpec {
  supportsImageInput: boolean;
  provider: string;
}

export interface NativeVisionImageInput {
  source: string;
  /** One-based Timeline Media Index. Omit for transient images such as annotations. */
  mediaIndex?: number;
}

export interface NativeVisionSnapshot {
  image_url?: string;
  type?: string;
  design_path?: string;
}

/** Resolve whether analyze_image stays in the selected Agent or needs a vision fallback. */
export function resolveAnalyzeImageProvider(
  runtime: { spec: ImageAnalysisRuntimeSpec },
): string {
  return runtime.spec.supportsImageInput ? runtime.spec.provider : 'gemini-api';
}

function isUsableVisionSource(source: string | undefined): source is string {
  return Boolean(source && (
    source.startsWith('data:image/')
    || source.startsWith('http://')
    || source.startsWith('https://')
  ));
}

/**
 * Pick only the still images the selected multimodal Agent needs in this turn.
 * The current edit target is always included, followed by fresh uploads or
 * explicitly referenced Timeline images.
 */
export function selectNativeVisionImages(
  snapshots: NativeVisionSnapshot[],
  options: {
    supportsImageInput: boolean;
    currentSnapshotIndex: number;
    explicitMediaIndices?: number[];
    turnMediaCount?: number;
  },
): NativeVisionImageInput[] {
  if (!options.supportsImageInput || snapshots.length === 0) return [];

  const trailingCount = Math.min(
    snapshots.length,
    Math.max(0, Math.floor(options.turnMediaCount || 0)),
  );
  const turnImages = trailingCount > 0
    ? Array.from({ length: trailingCount }, (_, offset) => snapshots.length - trailingCount + offset + 1)
    : (options.explicitMediaIndices ?? []);
  // The current canvas is always relevant. Fresh attachments/references are
  // additive visual context rather than a replacement for the edit target.
  const requested = [options.currentSnapshotIndex + 1, ...turnImages];

  const seen = new Set<number>();
  const selected: NativeVisionImageInput[] = [];
  for (const mediaIndex of requested) {
    if (!Number.isInteger(mediaIndex) || mediaIndex < 1 || mediaIndex > snapshots.length || seen.has(mediaIndex)) continue;
    seen.add(mediaIndex);
    const snapshot = snapshots[mediaIndex - 1];
    if (snapshot.type === 'video' || snapshot.design_path || !isUsableVisionSource(snapshot.image_url)) continue;
    selected.push({ source: snapshot.image_url, mediaIndex });
  }
  return selected;
}

/** Build one multimodal user message so text and images reach the Agent together. */
export function buildNativeVisionUserContent(
  text: string,
  images: NativeVisionImageInput[],
): Array<
  | { type: 'text'; text: string }
  | { type: 'file'; data: { type: 'data'; data: string } | URL; mediaType: string }
> {
  return [
    { type: 'text', text },
    ...images.flatMap((item) => {
      const dataUrl = item.source.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
      const url = dataUrl ? undefined : new URL(item.source);
      const extension = url?.pathname.match(/\.(png|webp|gif|jpe?g)$/i)?.[1]?.toLowerCase();
      const mediaType = dataUrl?.[1]
        || (extension === 'png' ? 'image/png'
          : extension === 'webp' ? 'image/webp'
            : extension === 'gif' ? 'image/gif'
              : 'image/jpeg');
      return [
        ...(item.mediaIndex
          ? [{ type: 'text' as const, text: `Image attached for <<<media_${item.mediaIndex}>>>:` }]
          : []),
        {
          type: 'file' as const,
          data: dataUrl
            ? { type: 'data' as const, data: dataUrl[2] }
            : url!,
          mediaType,
        },
      ];
    }),
  ];
}
