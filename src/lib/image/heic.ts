/** Check if a file is HEIC/HEIF format (not decodable by Chrome/Firefox). */
export function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif'
    || /\.(heic|heif)$/i.test(file.name);
}

/** Convert HEIC/HEIF to JPEG in the browser. Returns original file if not HEIC. */
export async function ensureDecodableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  const heic2any = (await import('heic2any')).default;
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const resultBlob = Array.isArray(blob) ? blob[0] : blob;
  return new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
}
