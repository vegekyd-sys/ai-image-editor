import { useCallback, useRef, useState } from 'react';
import { downloadBlob, shareableFile } from '@/lib/editor/media-transfer';
import { isNativePhotoLibrarySaveAvailable } from '@/lib/native-media';

export function usePreparedMediaShare<T>(key: T) {
  const activeKey = useRef(key);
  activeKey.current = key;
  const [prepared, setPrepared] = useState<{ key: T; file: File } | null>(null);
  const [shareState, setShareState] = useState<{ file: File; status: 'sharing' | 'failed' } | null>(null);
  const inFlight = useRef<symbol | null>(null);
  if (prepared && prepared.key !== key) setPrepared(null);
  const file = prepared?.key === key ? prepared.file : undefined;
  const status = shareState && shareState.file === file ? shareState.status : undefined;

  const offer = useCallback((blob: Blob, filename: string): boolean => {
    // An earlier request may have finished after navigation.
    if (activeKey.current !== key) return true;
    if (isNativePhotoLibrarySaveAvailable() || blob.type === 'image/svg+xml') return false;
    const next = shareableFile(blob, filename);
    if (!next) return false;
    setPrepared({ key, file: next });
    return true;
  }, [key]);

  const isCurrent = useCallback(() => activeKey.current === key, [key]);

  const share = async (): Promise<boolean> => {
    if (!file || inFlight.current) return false;
    const attempt = Symbol();
    inFlight.current = attempt;
    setShareState({ file, status: 'sharing' });
    const timer = setTimeout(() => {
      if (inFlight.current !== attempt) return;
      clearTimeout(timer);
      if (inFlight.current === attempt) {
        inFlight.current = null;
        setShareState(previous => previous?.file === file && previous.status === 'sharing' ? null : previous);
      }
    }, 15_000);
    try {
      // The click calling this function must be the first async step.
      await navigator.share({ files: [file] });
      return true;
    } catch (error) {
      if (inFlight.current === attempt && !(error instanceof Error && error.name === 'AbortError')) {
        setShareState({ file, status: 'failed' });
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (inFlight.current === attempt) {
        inFlight.current = null;
        setShareState(previous => previous?.file === file && previous.status === 'sharing' ? null : previous);
      }
    }
  };

  return {
    file,
    status,
    offer,
    share,
    download: () => { if (file) downloadBlob(file, file.name); },
    isCurrent,
  };
}
