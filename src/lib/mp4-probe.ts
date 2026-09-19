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
