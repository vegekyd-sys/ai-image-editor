const VIDEO_URL_RE = /https?:\/\/\S+\.(?:mp4|mov|webm)(?:[^\s<)]*)?/gi;

interface InlineVideoSnapshot {
  id: string;
  videoMeta?: {
    videoUrl?: string | null;
  };
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/g, '');
}

export function isProviderIntermediateVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'api.evolink.ai' || host.endsWith('.evolink.ai');
  } catch {
    return false;
  }
}

export function extractRenderableInlineVideoUrl(text: string): string | null {
  for (const match of text.matchAll(VIDEO_URL_RE)) {
    const url = stripTrailingPunctuation(match[0]);
    if (!isProviderIntermediateVideoUrl(url)) return url;
  }
  return null;
}

export function removeRenderableInlineVideoUrls(text: string): string {
  return text.replace(VIDEO_URL_RE, (raw) => {
    const url = stripTrailingPunctuation(raw);
    if (!isProviderIntermediateVideoUrl(url)) {
      return raw.slice(url.length);
    }
    return raw;
  });
}

export function removeAllInlineVideoUrls(text: string): string {
  return text.replace(VIDEO_URL_RE, (raw) => {
    const url = stripTrailingPunctuation(raw);
    return raw.slice(url.length);
  });
}

export function resolveInlineVideoCandidate<T extends InlineVideoSnapshot>(
  content: string,
  snapshots: T[],
): { url: string; navId?: string; videoSnap?: T | null; source: 'snapshot' | 'text' } | null {
  const animIdMatch = content.match(/anim:([a-f0-9-]+)/);
  const snapIdMatch = content.match(/snap:([a-f0-9-]+)/);
  const navId = snapIdMatch?.[1] || animIdMatch?.[1];
  const videoSnap = navId ? snapshots.find(s => s.id === navId) : null;
  const snapshotVideoUrl = videoSnap?.videoMeta?.videoUrl || undefined;

  if (snapshotVideoUrl) {
    return { url: snapshotVideoUrl, navId, videoSnap, source: 'snapshot' };
  }

  const textVideoUrl = extractRenderableInlineVideoUrl(content);
  if (!textVideoUrl) return null;
  return { url: textVideoUrl, navId, videoSnap, source: 'text' };
}
