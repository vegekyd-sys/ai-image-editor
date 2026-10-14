/**
 * Parse MP4 container to extract video dimensions from tkhd box.
 * Pure JS, no dependencies. Returns null if parsing fails.
 */
export function probeMP4Dimensions(buffer: Uint8Array): { width: number; height: number } | null {
  try {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let offset = 0

    while (offset < buffer.length - 8) {
      const size = view.getUint32(offset)
      const type = String.fromCharCode(
        buffer[offset + 4], buffer[offset + 5], buffer[offset + 6], buffer[offset + 7]
      )

      if (size < 8) break

      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
        // Container boxes — recurse into children
        offset += 8
        continue
      }

      if (type === 'tkhd') {
        // tkhd: width/height are the last 8 bytes (fixed-point 16.16)
        // v0: 92 bytes total, w/h at offset 84,88 from box start
        // v1: 104 bytes total, w/h at offset 96,100 from box start
        const version = buffer[offset + 8]
        const whOffset = version === 1 ? offset + 96 : offset + 84
        if (whOffset + 8 <= buffer.length) {
          const w = view.getUint32(whOffset) >>> 16
          const h = view.getUint32(whOffset + 4) >>> 16
          if (w > 0 && h > 0 && w < 10000 && h < 10000) {
            return { width: w, height: h }
          }
        }
      }

      offset += size
    }
    return null
  } catch {
    return null
  }
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
