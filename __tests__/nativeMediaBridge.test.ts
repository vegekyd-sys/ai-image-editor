import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNativePhotoLibraryPickerAvailable,
  isNativePhotoLibrarySaveAvailable,
  pickMediaFromNativePhotoLibrary,
  saveUrlToNativePhotoLibrary,
} from '@/lib/native-media';

type NativeMessage = {
  id: string;
  action: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  allowVideo?: boolean;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        makaronNative?: {
          postMessage: (message: NativeMessage) => void;
        };
      };
    };
  }
}

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

    respond(messages[0]);
    await expect(savePromise).resolves.toBeUndefined();
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
});
