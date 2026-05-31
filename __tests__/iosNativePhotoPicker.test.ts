import { describe, expect, it } from 'vitest';
import { acceptsNativeMediaPickerAccept, nativePickerAllowsVideo } from '@/lib/native-photo-picker';

describe('iOS native photo picker accept matching', () => {
  it('uses native picker for image, video, and iPhone HEIC inputs', () => {
    expect(acceptsNativeMediaPickerAccept('image/*')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('video/*')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('image/*,video/*,.heic,.heif')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('image/jpeg,image/png,image/webp')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('.HEIC,.HEIF')).toBe(true);
  });

  it('does not hijack non-media file uploads like skill zip imports', () => {
    expect(acceptsNativeMediaPickerAccept('.zip')).toBe(false);
    expect(acceptsNativeMediaPickerAccept('application/zip')).toBe(false);
  });

  it('only enables video selection when the input explicitly accepts videos', () => {
    expect(nativePickerAllowsVideo('image/*,video/*,.heic')).toBe(true);
    expect(nativePickerAllowsVideo('image/*,.heic,.heif')).toBe(false);
  });
});
