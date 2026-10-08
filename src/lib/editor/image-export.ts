import type { PreparedDownload } from './download';

export type ImageSaveSize = 'original' | '2k' | 'share';
export type ImageSaveFormat = 'original' | 'png' | 'jpeg';
export interface ImageExportInfo { width: number; height: number; mimeType: string }

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Fall back to the browser's image decoder. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function inspectImageExport(blob: Blob): Promise<ImageExportInfo> {
  const decoded = await decodeImage(blob);
  try { return { width: decoded.width, height: decoded.height, mimeType: blob.type }; }
  finally { decoded.close(); }
}

export function imageExportDimensions(info: ImageExportInfo, size: ImageSaveSize): { width: number; height: number } {
  const limit = size === '2k' ? 2048 : size === 'share' ? 1280 : Infinity;
  const scale = Math.min(1, limit / Math.max(info.width, info.height));
  return { width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)) };
}

/** Browser-only exports. The stored original and API/CLI artifacts are never modified. */
export async function exportImageDownload(asset: PreparedDownload, info: ImageExportInfo, size: ImageSaveSize, format: ImageSaveFormat): Promise<PreparedDownload> {
  const target = imageExportDimensions(info, size);
  const mimeType = format === 'original' ? info.mimeType : format === 'png' ? 'image/png' : 'image/jpeg';
  if (target.width === info.width && target.height === info.height && mimeType === asset.blob.type) return asset;
  const decoded = await decodeImage(asset.blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image export unavailable');
    if (mimeType === 'image/jpeg') {ctx.fillStyle = '#ffffff';ctx.fillRect(0, 0, target.width, target.height);}
    ctx.imageSmoothingEnabled = true;ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), mimeType, 0.92));
    if (blob.type !== mimeType) throw new Error('Requested image format is unavailable');
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    return { ...asset, blob, filename: asset.filename.replace(/\.[^.]+$/, `.${ext}`) };
  } finally { decoded.close(); }
}
