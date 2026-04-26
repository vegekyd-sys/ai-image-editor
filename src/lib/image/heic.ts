/** Check if a file is HEIC/HEIF format (not decodable by Chrome/Firefox). */
export function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif'
    || /\.(heic|heif)$/i.test(file.name);
}

/** Convert HEIC/HEIF to JPEG. Tries heic2any → server fallback (/api/upload with sips). */
export async function ensureDecodableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  // Try 1: heic2any WASM (works for most HEIC profiles)
  try {
    const heic2any = (await import('heic2any')).default;
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const resultBlob = Array.isArray(blob) ? blob[0] : blob;
    return new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch {
    // heic2any failed (unsupported profile like MiHB/MiHA from AirDrop)
  }
  // Try 2: Server-side conversion via sips (handles all macOS-supported HEIC profiles)
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (res.ok) {
      const { image } = await res.json();
      if (image) {
        const bin = atob(image.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
      }
    }
  } catch {
    // Server fallback also failed
  }
  throw new Error('HEIC conversion failed: unsupported format');
}
