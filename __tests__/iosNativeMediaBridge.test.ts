import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNativePhotoLibraryPickerAvailable,
  isNativePhotoLibrarySaveAvailable,
  pickMediaItemsFromNativePhotoLibrary,
  pickMediaFromNativePhotoLibrary,
  saveUrlToNativePhotoLibrary,
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
    vi.restoreAllMocks();
    sessionStorage.clear();
    delete window.webkit;
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
