import { ensureDecodableFile } from '@/lib/image/heic';

function drawImageToCanvas(img: HTMLImageElement, maxSize: number) {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Shared image utility: compress a File to a JPEG base64 data URL.
 * Handles HEIC automatically via ensureDecodableFile.
 */
export async function compressImageFile(
  file: File,
  maxSize = 1024,
  quality = 0.85,
): Promise<string> {
  const decodable = await ensureDecodableFile(file);
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(decodable);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = drawImageToCanvas(img, maxSize);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/**
 * Compress a base64 image only if it exceeds maxBytes.
 * Preserves quality by resizing only beyond 2048px and stepping quality down gradually.
 */
export async function compressBase64Image(image: string, maxBytes = 1_800_000): Promise<string> {
  if (!image || !image.startsWith('data:')) return image;
  if (image.length * 0.75 < maxBytes) return image;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 2048;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      for (const quality of [0.92, 0.85, 0.75, 0.65]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.length * 0.75 < maxBytes) {
          resolve(result);
          return;
        }
      }
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(image);
    img.src = image;
  });
}
