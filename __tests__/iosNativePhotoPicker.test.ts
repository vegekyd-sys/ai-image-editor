import { describe, expect, it } from 'vitest';
import { acceptsNativeMediaPickerAccept, nativePickerAllowsVideo } from '@/lib/native-photo-picker';

describe('iOS native photo picker accept matching', () => {
  it('uses native picker for image, video, and iPhone HEIC inputs', () => {
    expect(acceptsNativeMediaPickerAccept('image/*')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('video/*')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('image/*,video/*,.heic,.heif')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('image/jpeg,image/png,image/webp')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('.jpg,.jpeg,.png,.webp,.gif')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('.HEIC,.HEIF')).toBe(true);
    expect(acceptsNativeMediaPickerAccept('.mov,.mp4,.m4v')).toBe(true);
  });

  it('does not hijack non-media file uploads like skill zip imports', () => {
    expect(acceptsNativeMediaPickerAccept('.zip')).toBe(false);
    expect(acceptsNativeMediaPickerAccept('application/zip')).toBe(false);
    expect(acceptsNativeMediaPickerAccept('.pdf,.txt')).toBe(false);
    expect(acceptsNativeMediaPickerAccept('')).toBe(false);
  });

  it('only enables video selection when the input explicitly accepts videos', () => {
    expect(nativePickerAllowsVideo('image/*,video/*,.heic')).toBe(true);
    expect(nativePickerAllowsVideo('image/*,.mov,.mp4,.m4v')).toBe(true);
    expect(nativePickerAllowsVideo('image/*,.heic,.heif')).toBe(false);
    expect(nativePickerAllowsVideo('.jpg,.png')).toBe(false);
  });
});
