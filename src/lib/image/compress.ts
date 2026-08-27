import { ensureDecodableFile } from '@/lib/image/heic';

function drawImageToCanvas(img: HTMLImageElement, maxSize: number) {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function mayContainAlpha(file: Pick<File, 'type' | 'name'>): boolean {
  return /^(?:image\/(?:png|webp|avif))$/i.test(file.type)
    || /\.(?:png|webp|avif)$/i.test(file.name);
}

export function uploadCanvasMimeType(file: Pick<File, 'type' | 'name'>): 'image/png' | 'image/jpeg' {
  return mayContainAlpha(file) ? 'image/png' : 'image/jpeg';
}

function dataUrlMayContainAlpha(image: string): boolean {
  return /^data:image\/(?:png|webp|avif);/i.test(image);
}

/** Inspect a decoded data URL at low resolution. Used during project ingest to
 * persist alpha metadata rather than guessing from a PNG/WebP extension. */
export async function inspectDataUrlAlpha(image: string): Promise<boolean> {
  if (!dataUrlMayContainAlpha(image)) return false;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(false);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if (pixels[offset] < 255) return resolve(true);
        }
        resolve(false);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = image;
  });
}

/**
 * Shared image utility: resize a File to a base64 data URL.
 * PNG/WebP/AVIF inputs stay alpha-capable; JPEG/HEIC stay JPEG.
 */
export async function compressImageFile(
  file: File,
  maxSize = 1024,
  quality = 0.85,
): Promise<string> {
  const decodable = await ensureDecodableFile(file);
  const preserveAlpha = mayContainAlpha(decodable);
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(decodable);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = drawImageToCanvas(img, maxSize);
      resolve(canvas.toDataURL(preserveAlpha ? 'image/png' : 'image/jpeg', quality));
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
      const outputType = dataUrlMayContainAlpha(image) ? 'image/webp' : 'image/jpeg';
      for (const quality of [0.92, 0.85, 0.75, 0.65]) {
        const result = canvas.toDataURL(outputType, quality);
        if (result.length * 0.75 < maxBytes) {
          resolve(result);
          return;
        }
      }
      resolve(canvas.toDataURL(outputType, 0.6));
    };
    img.onerror = () => resolve(image);
    img.src = image;
  });
}
