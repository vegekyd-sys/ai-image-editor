const MEDIA_MARKER_PATTERN = /<<<media_(\d+)>>>/g;

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
