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

let heicWorker: Worker | null = null;
let heicWorkerSeq = 0;
const heicWorkerCallbacks = new Map<number, (result: { blob?: Blob; error?: string }) => void>();

/** Decode in a Web Worker with libheif 1.19 → resized JPEG (≤2048px). */
async function convertInWorker(file: File): Promise<File | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    if (!heicWorker) {
      heicWorker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });
      heicWorker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
        heicWorkerCallbacks.get(event.data.id)?.(event.data);
        heicWorkerCallbacks.delete(event.data.id);
      };
      heicWorker.onerror = () => {
        for (const cb of heicWorkerCallbacks.values()) cb({ error: 'HEIC worker crashed' });
        heicWorkerCallbacks.clear();
        heicWorker?.terminate();
        heicWorker = null;
      };
    }
    const id = ++heicWorkerSeq;
    const buffer = await file.arrayBuffer();
    const result = await new Promise<{ blob?: Blob; error?: string }>((resolve) => {
      heicWorkerCallbacks.set(id, resolve);
      heicWorker!.postMessage({ id, buffer, maxSize: 2048, quality: 0.92 }, [buffer]);
    });
    if (!result.blob) {
      console.warn('[HEIC] worker decode failed:', result.error);
      return null;
    }
    return new File([result.blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[HEIC] worker unavailable:', err);
    return null;
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
 * Convert HEIC/HEIF to JPEG: native decode (Safari) → libheif Web Worker →
 * server conversion (signed-in users; returns a 2048px JPEG) → heic2any WASM.
 *
 * Uploading the original to /api/upload is slow on weak uplinks (and blocks
 * other requests to the same origin), so the worker path comes first.
 * heic2any runs on the main thread, can freeze the page for tens of seconds
 * and fails on many modern iPhone HEIC profiles, so it is the last resort
 * (anonymous users, whose server request is rejected).
 */
const conversionCache = new WeakMap<File, Promise<File>>();

export function ensureDecodableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return Promise.resolve(file);
  // Attach-time preview, eager preparation and send can all ask for the same
  // file; share one conversion instead of uploading it to the server twice.
  let pending = conversionCache.get(file);
  if (!pending) {
    pending = convertHeic(file);
    conversionCache.set(file, pending);
    pending.catch(() => conversionCache.delete(file));
  }
  return pending;
}

async function convertHeic(file: File): Promise<File> {
  if (await canDecodeNatively(file)) return file;
  const fromWorker = await convertInWorker(file);
  if (fromWorker) return fromWorker;
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
