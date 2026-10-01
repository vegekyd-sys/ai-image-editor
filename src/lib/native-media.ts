'use client';

type NativeMediaType = 'image' | 'video';

interface NativeResponseDetail {
  id?: string;
  ok?: boolean;
  error?: string;
  localIdentifier?: string;
  dataUrl?: string;
  filename?: string;
  mimeType?: string;
  mediaType?: NativeMediaType;
  items?: NativePickedMedia[];
}

const LAST_NATIVE_MEDIA_RESULT_KEY = 'makaron:native-media:last-result';
const IMAGE_SAVE_TIMEOUT_MS = 45000;
const VIDEO_SAVE_TIMEOUT_MS = 120000;

type NativePayload = {
  id: string;
} & ({
  action: 'saveToPhotos';
  mediaType: NativeMediaType;
  filename: string;
  url?: string;
  dataUrl?: string;
} | {
  action: 'saveWatermarkedVideoToPhotos';
  mediaType: 'video';
  filename: string;
  dataUrl: string;
  watermarkDataUrl: string;
} | {
  action: 'cancelMediaExport';
  requestId: string;
} | {
  action: 'pickMedia';
  allowVideo?: boolean;
  multiple?: boolean;
});
type NativeMessage = Omit<Extract<NativePayload, { action: 'saveToPhotos' }>, 'id'>
  | Omit<Extract<NativePayload, { action: 'saveWatermarkedVideoToPhotos' }>, 'id'>
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

function sendNativeMessage<T>(message: NativeMessage, timeoutMs: number, signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<T> {
  if (!isNativeMediaBridgeAvailable()) {
    return Promise.reject(new Error('Native photo library bridge is not available'));
  }

  const id = `native-${Date.now().toString(36)}-${(nativeMessageId += 1).toString(36)}`;
  const nativeMessage: NativePayload = { ...message, id } as NativePayload;
  signal?.throwIfAborted();

	  return new Promise((resolve, reject) => {
	    const cleanup = () => {
	      window.clearTimeout(timeout);
	      window.removeEventListener('makaron-native-response', onResponse);
	      window.removeEventListener('makaron-native-progress', progress);
	      signal?.removeEventListener('abort', abort);
	    };
	    const cancelExport = () => {
	      if (message.action === 'saveWatermarkedVideoToPhotos') {
	        window.webkit?.messageHandlers?.makaronNative?.postMessage({ id: `${id}-cancel`, action: 'cancelMediaExport', requestId: id });
	      }
	    };
	    const abort = () => {cleanup();cancelExport();reject(new DOMException('Export canceled', 'AbortError'));};
	    const progress = (event: Event) => {
	      const detail = (event as CustomEvent<{ id: string; progress: number }>).detail;
	      if (detail?.id === id && Number.isFinite(detail.progress)) onProgress?.(Math.max(0, Math.min(1, detail.progress)));
	    };
	    const timeout = window.setTimeout(() => {
	      cleanup();cancelExport();
	      try {
	        sessionStorage.setItem(LAST_NATIVE_MEDIA_RESULT_KEY, JSON.stringify({
	          id,
	          action: nativeMessage.action,
	          mediaType: 'mediaType' in nativeMessage ? nativeMessage.mediaType : undefined,
	          ok: false,
	          error: 'Native media request timed out',
	          phase: 'timeout',
	          t: Date.now(),
	        }));
	      } catch {
	        // Diagnostics are best-effort only.
	      }
	      reject(new Error('Native media request timed out'));
	    }, timeoutMs);

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<NativeResponseDetail>).detail;
      if (detail?.id !== id) return;
      cleanup();
      if (detail.ok) {
        try {
          sessionStorage.setItem(LAST_NATIVE_MEDIA_RESULT_KEY, JSON.stringify({ ...detail, t: Date.now() }));
        } catch {
          // Diagnostics are best-effort only.
        }
        resolve(detail as T);
      } else {
        try {
          sessionStorage.setItem(LAST_NATIVE_MEDIA_RESULT_KEY, JSON.stringify({ ...detail, t: Date.now() }));
        } catch {
          // Diagnostics are best-effort only.
        }
        reject(new Error(detail?.error || 'Native media request failed'));
      }
    }

	    window.addEventListener('makaron-native-response', onResponse);
	    window.addEventListener('makaron-native-progress', progress);
	    signal?.addEventListener('abort', abort, { once: true });
	    try {
	      try {
	        sessionStorage.setItem(LAST_NATIVE_MEDIA_RESULT_KEY, JSON.stringify({
	          id,
	          action: nativeMessage.action,
	          mediaType: 'mediaType' in nativeMessage ? nativeMessage.mediaType : undefined,
	          ok: null,
	          phase: 'sent',
	          t: Date.now(),
	        }));
	      } catch {
	        // Diagnostics are best-effort only.
	      }
	      window.webkit?.messageHandlers?.makaronNative?.postMessage(nativeMessage);
	    } catch (error) {
	      cleanup();
	      try {
	        sessionStorage.setItem(LAST_NATIVE_MEDIA_RESULT_KEY, JSON.stringify({
	          id,
	          action: nativeMessage.action,
	          mediaType: 'mediaType' in nativeMessage ? nativeMessage.mediaType : undefined,
	          ok: false,
	          error: error instanceof Error ? error.message : String(error),
	          phase: 'postMessage-error',
	          t: Date.now(),
	        }));
	      } catch {
	        // Diagnostics are best-effort only.
	      }
	      reject(error);
	    }
	  });
}

function sendNativeSaveMessage(payload: Omit<Extract<NativePayload, { action: 'saveToPhotos' }>, 'id' | 'action'>): Promise<void> {
  const timeoutMs = payload.mediaType === 'video' ? VIDEO_SAVE_TIMEOUT_MS : IMAGE_SAVE_TIMEOUT_MS;
  return sendNativeMessage<NativeResponseDetail>({ action: 'saveToPhotos', ...payload }, timeoutMs).then(() => undefined);
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

export async function saveWatermarkedVideoToNativePhotoLibrary(blob: Blob, filename: string, watermarkDataUrl: string,
  onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const dataUrl = await blobToDataUrl(blob);
  await sendNativeMessage({ action: 'saveWatermarkedVideoToPhotos', mediaType: 'video', dataUrl,
    filename: filename.replace(/\.[^.]+$/, '.mp4'), watermarkDataUrl }, VIDEO_SAVE_TIMEOUT_MS, signal, onProgress);
}

export function saveUrlToNativePhotoLibrary(url: string, filename: string, mediaType: NativeMediaType): Promise<void> {
  return sendNativeSaveMessage({ url, filename, mediaType });
}

function normalizePickedMedia(result: NativeResponseDetail): NativePickedMedia | null {
  if (!result.dataUrl || !result.filename || !result.mimeType) return null;
  return {
    dataUrl: result.dataUrl,
    filename: result.filename,
    mimeType: result.mimeType,
    mediaType: result.mediaType || (result.mimeType.startsWith('video/') ? 'video' : 'image'),
  };
}

export async function pickMediaItemsFromNativePhotoLibrary(options?: { allowVideo?: boolean; multiple?: boolean }): Promise<NativePickedMedia[]> {
  const result = await sendNativeMessage<NativeResponseDetail>({
    action: 'pickMedia',
    allowVideo: options?.allowVideo ?? false,
    multiple: options?.multiple ?? false,
  }, 180000);
  const items = Array.isArray(result.items) && result.items.length > 0
    ? result.items
    : [normalizePickedMedia(result)].filter((item): item is NativePickedMedia => item !== null);
  if (items.length === 0) {
    throw new Error('Native picker returned incomplete media');
  }
  return items;
}

export async function pickMediaFromNativePhotoLibrary(options?: { allowVideo?: boolean }): Promise<NativePickedMedia> {
  const items = await pickMediaItemsFromNativePhotoLibrary({ ...options, multiple: false });
  return items[0];
}
