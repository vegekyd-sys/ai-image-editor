'use client';

type NativeMediaType = 'image' | 'video';

interface NativeResponseDetail {
  id?: string;
  ok?: boolean;
  error?: string;
  dataUrl?: string;
  filename?: string;
  mimeType?: string;
  mediaType?: NativeMediaType;
}

type NativePayload = {
  id: string;
} & ({
  action: 'saveToPhotos';
  mediaType: NativeMediaType;
  filename: string;
  url?: string;
  dataUrl?: string;
} | {
  action: 'pickMedia';
  allowVideo?: boolean;
});
type NativeMessage = Omit<Extract<NativePayload, { action: 'saveToPhotos' }>, 'id'>
  | Omit<Extract<NativePayload, { action: 'pickMedia' }>, 'id'>;

export interface NativePickedMedia {
  dataUrl: string;
  filename: string;
  mimeType: string;
  mediaType: NativeMediaType;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        makaronNative?: {
          postMessage: (message: NativePayload) => void;
        };
      };
    };
  }
}

let nativeMessageId = 0;

export function isNativeMediaBridgeAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof window.webkit?.messageHandlers?.makaronNative?.postMessage === 'function';
}

export function isNativePhotoLibrarySaveAvailable(): boolean {
  return isNativeMediaBridgeAvailable();
}

export function isNativePhotoLibraryPickerAvailable(): boolean {
  return isNativeMediaBridgeAvailable();
}

function sendNativeMessage<T>(message: NativeMessage, timeoutMs: number): Promise<T> {
  if (!isNativeMediaBridgeAvailable()) {
    return Promise.reject(new Error('Native photo library bridge is not available'));
  }

  const id = `native-${Date.now().toString(36)}-${(nativeMessageId += 1).toString(36)}`;
  const nativeMessage: NativePayload = { ...message, id } as NativePayload;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('makaron-native-response', onResponse);
      reject(new Error('Native media request timed out'));
    }, timeoutMs);

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<NativeResponseDetail>).detail;
      if (detail?.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('makaron-native-response', onResponse);
      if (detail.ok) {
        resolve(detail as T);
      } else {
        reject(new Error(detail?.error || 'Native media request failed'));
      }
    }

    window.addEventListener('makaron-native-response', onResponse);
    try {
      window.webkit?.messageHandlers?.makaronNative?.postMessage(nativeMessage);
    } catch (error) {
      window.clearTimeout(timeout);
      window.removeEventListener('makaron-native-response', onResponse);
      reject(error);
    }
  });
}

function sendNativeSaveMessage(payload: Omit<Extract<NativePayload, { action: 'saveToPhotos' }>, 'id' | 'action'>): Promise<void> {
  return sendNativeMessage<void>({ action: 'saveToPhotos', ...payload }, 120000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode media for native save'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read media for native save'));
    reader.readAsDataURL(blob);
  });
}

export async function saveBlobToNativePhotoLibrary(blob: Blob, filename: string, mediaType: NativeMediaType): Promise<void> {
  const dataUrl = await blobToDataUrl(blob);
  await sendNativeSaveMessage({ dataUrl, filename, mediaType });
}

export function saveUrlToNativePhotoLibrary(url: string, filename: string, mediaType: NativeMediaType): Promise<void> {
  return sendNativeSaveMessage({ url, filename, mediaType });
}

export async function pickMediaFromNativePhotoLibrary(options?: { allowVideo?: boolean }): Promise<NativePickedMedia> {
  const result = await sendNativeMessage<NativeResponseDetail>({
    action: 'pickMedia',
    allowVideo: options?.allowVideo ?? false,
  }, 180000);
  if (!result.dataUrl || !result.filename || !result.mimeType) {
    throw new Error('Native picker returned incomplete media');
  }
  return {
    dataUrl: result.dataUrl,
    filename: result.filename,
    mimeType: result.mimeType,
    mediaType: result.mediaType || (result.mimeType.startsWith('video/') ? 'video' : 'image'),
  };
}
