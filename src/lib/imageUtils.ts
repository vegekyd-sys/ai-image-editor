/**
 * Shared image utility: compress a File to a JPEG base64 data URL.
 * Used by AgentChatView and AnnotationToolbar for attached reference images.
 */
export function compressImageFile(
  file: File,
  maxSize = 1024,
  quality = 0.85,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const url = URL.createObjectURL(file);
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
