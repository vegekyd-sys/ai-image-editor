import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNativePhotoLibraryPickerAvailable,
  isNativePhotoLibrarySaveAvailable,
  pickMediaItemsFromNativePhotoLibrary,
  pickMediaFromNativePhotoLibrary,
  saveUrlToNativePhotoLibrary,
  saveWatermarkedVideoToNativePhotoLibrary,
} from '@/lib/native-media';

type NativeBridge = NonNullable<NonNullable<NonNullable<Window['webkit']>['messageHandlers']>['makaronNative']>;
type NativeMessage = Parameters<NativeBridge['postMessage']>[0];

function installNativeBridgeMock() {
  const messages: NativeMessage[] = [];
  window.webkit = {
    messageHandlers: {
      makaronNative: {
        postMessage: vi.fn((message: NativeMessage) => {
          messages.push(message);
        }),
      },
    },
  };
  return messages;
}

function respond(message: NativeMessage, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('makaron-native-response', {
    detail: { id: message.id, ok: true, ...detail },
  }));
}

describe('native media bridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    delete window.webkit;
  });

  it('sends the exact signature and original video to native composition and receives scoped progress', async () => {
    const messages = installNativeBridgeMock(), progress = vi.fn();
    const promise = saveWatermarkedVideoToNativePhotoLibrary(new Blob(['video'], { type: 'video/mp4' }), 'work.mov', 'data:image/png;base64,mark', progress);
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toMatchObject({ action: 'saveWatermarkedVideoToPhotos', mediaType: 'video', filename: 'work.mp4', watermarkDataUrl: 'data:image/png;base64,mark', dataUrl: 'data:video/mp4;base64,dmlkZW8=' });
    window.dispatchEvent(new CustomEvent('makaron-native-progress', { detail: { id: 'other', progress: .5 } }));
    expect(progress).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('makaron-native-progress', { detail: { id: messages[0].id, progress: .5 } }));
    expect(progress).toHaveBeenCalledWith(.5);
    respond(messages[0]);await expect(promise).resolves.toBeUndefined();
  });

  it('cancels the native export when Save closes and never sends a clean fallback', async () => {
    const messages = installNativeBridgeMock(), controller = new AbortController();
    const promise = saveWatermarkedVideoToNativePhotoLibrary(new Blob(['video']), 'work.mp4', 'data:image/png;base64,mark', undefined, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    controller.abort();await rejection;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ action: 'cancelMediaExport', requestId: messages[0].id });
    expect(messages.every(message => message.action !== 'saveToPhotos')).toBe(true);
  });

  it('fails closed on an old native binary without video-watermark support', async () => {
    const messages = installNativeBridgeMock();
    const promise = saveWatermarkedVideoToNativePhotoLibrary(new Blob(['video']), 'work.mp4', 'data:image/png;base64,mark');
    const rejection = expect(promise).rejects.toThrow('Unsupported native action');
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    respond(messages[0], { ok: false, error: 'Unsupported native action' });
    await rejection;expect(messages).toHaveLength(1);
  });

  it('sends photo library save requests through the iOS native bridge', async () => {
    const messages = installNativeBridgeMock();

    const savePromise = saveUrlToNativePhotoLibrary('https://cdn.example.com/out.jpg', 'out.jpg', 'image');
    expect(isNativePhotoLibrarySaveAvailable()).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      action: 'saveToPhotos',
      url: 'https://cdn.example.com/out.jpg',
      filename: 'out.jpg',
      mediaType: 'image',
    });
    expect(JSON.parse(sessionStorage.getItem('makaron:native-media:last-result') || '{}')).toMatchObject({
      ok: null,
      phase: 'sent',
      mediaType: 'image',
    });

    respond(messages[0], { localIdentifier: 'asset-id-1', mediaType: 'image' });
    await expect(savePromise).resolves.toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem('makaron:native-media:last-result') || '{}')).toMatchObject({
      ok: true,
      localIdentifier: 'asset-id-1',
      mediaType: 'image',
    });
  });

  it('resolves native picker responses into selected media data', async () => {
    const messages = installNativeBridgeMock();

    const pickPromise = pickMediaFromNativePhotoLibrary({ allowVideo: true });
    expect(isNativePhotoLibraryPickerAvailable()).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      action: 'pickMedia',
      allowVideo: true,
    });

    respond(messages[0], {
      dataUrl: 'data:image/jpeg;base64,AA==',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      mediaType: 'image',
    });

    await expect(pickPromise).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,AA==',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      mediaType: 'image',
    });
  });

  it('requests and preserves every item from a native multi-select picker response', async () => {
    const messages = installNativeBridgeMock();

    const pickPromise = pickMediaItemsFromNativePhotoLibrary({ allowVideo: false, multiple: true });
    expect(messages[0]).toMatchObject({
      action: 'pickMedia',
      allowVideo: false,
      multiple: true,
    });

    respond(messages[0], {
      items: [
        { dataUrl: 'data:image/jpeg;base64,AA==', filename: 'IMG_0001.jpg', mimeType: 'image/jpeg', mediaType: 'image' },
        { dataUrl: 'data:image/jpeg;base64,BB==', filename: 'IMG_0002.jpg', mimeType: 'image/jpeg', mediaType: 'image' },
      ],
    });

    await expect(pickPromise).resolves.toEqual([
      { dataUrl: 'data:image/jpeg;base64,AA==', filename: 'IMG_0001.jpg', mimeType: 'image/jpeg', mediaType: 'image' },
      { dataUrl: 'data:image/jpeg;base64,BB==', filename: 'IMG_0002.jpg', mimeType: 'image/jpeg', mediaType: 'image' },
    ]);
  });
});
