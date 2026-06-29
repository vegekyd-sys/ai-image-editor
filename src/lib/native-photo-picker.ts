export function acceptsNativeMediaPickerAccept(accept: string): boolean {
  const normalized = accept.toLowerCase();
  return normalized.includes('image/')
    || normalized.includes('video/')
    || normalized.includes('.jpg')
    || normalized.includes('.jpeg')
    || normalized.includes('.png')
    || normalized.includes('.webp')
    || normalized.includes('.gif')
    || normalized.includes('.heic')
    || normalized.includes('.heif')
    || normalized.includes('.mov')
    || normalized.includes('.mp4')
    || normalized.includes('.m4v');
}

export function nativePickerAllowsVideo(accept: string): boolean {
  const normalized = accept.toLowerCase();
  return normalized.includes('video/')
    || normalized.includes('.mov')
    || normalized.includes('.mp4')
    || normalized.includes('.m4v');
}
