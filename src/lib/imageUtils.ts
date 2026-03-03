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

/**
 * Shared image utility: compress a File to a JPEG base64 data URL.
 * Used by AgentChatView and AnnotationToolbar for attached reference images.
 * Handles HEIC automatically via ensureDecodableFile.
 */
export async function compressImageFile(
  file: File,
  maxSize = 1024,
  quality = 0.85,
): Promise<string> {
  const decodable = await ensureDecodableFile(file);
  return new Promise<string>((resolve) => {
    const url = URL.createObjectURL(decodable);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = url;
  });
}
