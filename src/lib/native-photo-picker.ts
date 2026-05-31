export function acceptsNativeMediaPickerAccept(accept: string): boolean {
  const normalized = accept.toLowerCase();
  return normalized.includes('image/')
    || normalized.includes('video/')
    || normalized.includes('.heic')
    || normalized.includes('.heif');
}

export function nativePickerAllowsVideo(accept: string): boolean {
  return accept.toLowerCase().includes('video/');
}
