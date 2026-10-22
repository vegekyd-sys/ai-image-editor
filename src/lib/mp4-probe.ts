/** Display dimensions from the video track, including the tkhd transform.
 * Phone MOV/MP4 files often store landscape pixels plus a 90-degree matrix.
 * The dimensions supplied to layout must match the decoded, upright picture. */
export function probeMP4Dimensions(buffer: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  type Box = { type: string; body: number; end: number };
  function boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8));
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) break;
      result.push({ type, body: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  }
  try {
    for (const movie of boxes(0, buffer.length).filter(box => box.type === 'moov')) {
      for (const track of boxes(movie.body, movie.end).filter(box => box.type === 'trak')) {
        const children = boxes(track.body, track.end);
        const mdia = children.find(box => box.type === 'mdia');
        const handler = mdia && boxes(mdia.body, mdia.end).find(box => box.type === 'hdlr');
        if (handler) {
          if (handler.body + 12 > handler.end) continue;
          if (String.fromCharCode(...buffer.subarray(handler.body + 8, handler.body + 12)) !== 'vide') continue;
        }
        const tkhd = children.find(box => box.type === 'tkhd');
        if (!tkhd) continue;
        const version = buffer[tkhd.body];
        if (version !== 0 && version !== 1) continue;
        const matrix = tkhd.body + (version === 1 ? 52 : 40);
        const wh = matrix + 36;
        if (wh + 8 > tkhd.end) continue;
        const w = view.getUint32(wh) / 65536;
        const h = view.getUint32(wh + 4) / 65536;
        const a = view.getInt32(matrix) / 65536;
        const b = view.getInt32(matrix + 4) / 65536;
        const c = view.getInt32(matrix + 12) / 65536;
        const d = view.getInt32(matrix + 16) / 65536;
        const width = Math.round(Math.abs(a) * w + Math.abs(c) * h);
        const height = Math.round(Math.abs(b) * w + Math.abs(d) * h);
        if (width > 0 && height > 0 && width < 100000 && height < 100000) return { width, height };
      }
    }
  } catch { /* Malformed/truncated containers remain unknown. */ }
  return null;
}

/** Movie-header duration for MP4/MOV reference billing; unknown is never zero. */
export function probeMP4Duration(buffer: Uint8Array): number | undefined {
  try {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let offset = 0
    while (offset + 8 <= buffer.length) {
      const size = view.getUint32(offset)
      const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8))
      if (size < 8 || offset + size > buffer.length) return undefined
      if (type === 'moov') { offset += 8; continue }
      if (type === 'mvhd') {
        const v1 = buffer[offset + 8] === 1
        const scale = view.getUint32(offset + (v1 ? 28 : 20))
        const ticks = v1 ? Number(view.getBigUint64(offset + 32)) : view.getUint32(offset + 24)
        const seconds = ticks / scale
        return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
      }
      offset += size
    }
  } catch { /* Unreadable media must be rejected by the billing caller. */ }
  return undefined
}

/** Inspect track handlers, never infer sound from a filename or provider flag.
 * undefined means unreadable/unsupported; false means a complete moov without
 * a sound track. Handles large-size and parent-extending ISO BMFF boxes.
 */
export function probeMP4HasAudio(buffer: Uint8Array): boolean | undefined {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let foundMovie = false;
  let foundAudio = false;
  function walk(start: number, end: number, context: string): void {
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end) throw new Error('Incomplete box');
      let size = view.getUint32(offset);
      const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8));
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw new Error('Incomplete large box');
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) throw new Error('Invalid box');
      if (type === 'moov' && context === '') {
        foundMovie = true;
        walk(offset + header, offset + size, 'moov');
      } else if ((type === 'trak' && context === 'moov') || (type === 'mdia' && context === 'trak')) {
        walk(offset + header, offset + size, type);
      } else if (type === 'hdlr' && context === 'mdia') {
        if (size < header + 12) throw new Error('Incomplete handler');
        const handler = String.fromCharCode(...buffer.subarray(offset + header + 8, offset + header + 12));
        if (handler === 'soun') foundAudio = true;
      }
      offset += size;
    }
  }
  try { walk(0, buffer.length, ''); return foundMovie ? foundAudio : undefined; }
  catch { return undefined; }
}
