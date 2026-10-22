import { probeMP4Dimensions } from './mp4-probe';

export interface VideoDimensions { width: number; height: number }

/** Read top-level BMFF headers and only download moov. Skips mdat by byte
 * offset, so large sources and moov-at-end files need no full download. Servers
 * ignoring Range are bounded too; an unmeasurable source stays unknown. */
export async function probeVideoDimensionsFromUrl(
  url: string, fetchImpl: typeof fetch = fetch,
): Promise<VideoDimensions | null> {
  const maxBytes = 8 * 1024 * 1024;
  let downloaded = 0;
  const signal = AbortSignal.timeout(30_000);
  async function read(start: number, length: number): Promise<Uint8Array | null> {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=${start}-${start + length - 1}` }, signal,
    });
    if (!response.ok || !response.body) return null;
    // A full response cannot stand in for a nonzero byte offset.
    if (start > 0 && response.status !== 206) { await response.body.cancel(); return null; }
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== start) { await response.body.cancel(); return null; }
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < length) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        if (downloaded > maxBytes) return null;
        const part = value.subarray(0, length - size);
        chunks.push(part); size += part.byteLength;
      }
    } finally { await reader.cancel(); }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data;
  }
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return null;
    // Reuse a bounded window for adjacent ftyp/uuid/free headers. A phone
    // MP4 can otherwise need six remote round trips before its tail moov,
    // exhausting the same deadline despite transferring only a few bytes.
    const windowBytes = 64 * 1024;
    let windowStart = -1;
    let window: Uint8Array = new Uint8Array();
    async function at(start: number, length: number): Promise<Uint8Array | null> {
      if (start >= windowStart && start + length <= windowStart + window.length) {
        return window.subarray(start - windowStart, start - windowStart + length);
      }
      windowStart = start;
      const bytes = await read(start, Math.max(windowBytes, length));
      if (!bytes) return null;
      window = bytes;
      return bytes.subarray(0, length);
    }
    let offset = 0;
    for (let box = 0; box < 32; box++) {
      const header = await at(offset, 16);
      if (!header || header.length < 8) return null;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      let size = view.getUint32(0);
      const type = String.fromCharCode(...header.subarray(4, 8));
      const headerSize = size === 1 ? 16 : 8;
      if (size === 1) { if (header.length < 16) return null; size = Number(view.getBigUint64(8)); }
      if (!Number.isSafeInteger(size) || size < headerSize) return null;
      if (type === 'moov') {
        if (size + downloaded > maxBytes) return null;
        const movie = await at(offset, size);
        return movie?.length === size ? probeMP4Dimensions(movie) : null;
      }
      offset += size;
      if (!Number.isSafeInteger(offset)) return null;
    }
  } catch { /* No guessing from filenames, descriptions, or encoded shape. */ }
  return null;
}
