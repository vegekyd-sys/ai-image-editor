/** Check if a file is HEIC/HEIF format (not decodable by Chrome/Firefox). */
export function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif'
    || /\.(heic|heif)$/i.test(file.name);
}

const nativeDecodeCache = new WeakMap<File, Promise<boolean>>();

/** Safari (iOS 17+/macOS) decodes HEIC natively; skip the slow WASM path there. */
function canDecodeNatively(file: File): Promise<boolean> {
  let cached = nativeDecodeCache.get(file);
  if (!cached) {
    cached = probeNativeDecode(file);
    nativeDecodeCache.set(file, cached);
  }
  return cached;
}

async function probeNativeDecode(file: File): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth > 0;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertOnServer(file: File): Promise<File | null> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const { image } = await res.json();
    if (!image) return null;
    const blob = await (await fetch(image)).blob();
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

/**
 * Convert HEIC/HEIF to JPEG: native decode (Safari) → server conversion
 * (signed-in users; returns a 2048px JPEG) → heic2any WASM.
 *
 * heic2any runs on the main thread, can freeze the page for tens of seconds
 * and fails on many modern iPhone HEIC profiles, so it is the last resort
 * (anonymous users, whose server request is rejected).
 */
export async function ensureDecodableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  if (await canDecodeNatively(file)) return file;
  const fromServer = await convertOnServer(file);
  if (fromServer) return fromServer;
  try {
    const heic2any = (await import('heic2any')).default;
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const resultBlob = Array.isArray(blob) ? blob[0] : blob;
    return new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch {
    // heic2any failed (unsupported profile like MiHB/MiHA from AirDrop)
  }
  throw new Error('HEIC conversion failed: unsupported format');
}
