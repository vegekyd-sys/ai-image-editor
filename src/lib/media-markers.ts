const MEDIA_MARKER_PATTERN = /<<<media_(\d+)>>>/g;
const USER_MEDIA_REFERENCE_PATTERN = /<<<media_(\d+)>>>|(^|\s)@(\d+)\b/g;

export function extractUserReferencedMediaIndices(value: string): number[] {
  const indices = new Set<number>();
  for (const match of value.matchAll(USER_MEDIA_REFERENCE_PATTERN)) {
    const index = Number(match[1] || match[3]);
    if (Number.isInteger(index) && index > 0) indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}

export function resolveMediaMarkersInString(value: string, mediaUrls: string[]): string {
  return value.replace(MEDIA_MARKER_PATTERN, (marker, rawIndex) => {
    const media = mediaUrls[Number(rawIndex) - 1];
    return media || marker;
  });
}

export function resolveMediaMarkersInValue(value: unknown, mediaUrls: string[]): unknown {
  if (typeof value === 'string') return resolveMediaMarkersInString(value, mediaUrls);
  if (Array.isArray(value)) return value.map(item => resolveMediaMarkersInValue(item, mediaUrls));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, resolveMediaMarkersInValue(item, mediaUrls)])
    );
  }
  return value;
}
