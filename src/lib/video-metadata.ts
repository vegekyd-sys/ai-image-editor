import { probeMP4Dimensions, probeMP4Duration } from './mp4-probe';

export interface ProbedVideoMetadata { width?: number; height?: number; duration?: number }

export function probeVideoMetadata(bytes: Uint8Array): ProbedVideoMetadata {
  return { ...probeMP4Dimensions(bytes), duration: probeMP4Duration(bytes) };
}

/** Bounded container inspection only: never infer duration from an LLM description. */
export async function probeVideoMetadataFromUrl(url: string, maxBytes = 55 * 1024 * 1024): Promise<ProbedVideoMetadata | null> {
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get('content-length')) > maxBytes) {
      await res.body.cancel();
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return probeVideoMetadata(Buffer.concat(chunks));
  } catch { return null; }
}
