import { useCallback, useRef, useState } from 'react';
import { downloadBlob, shareableFile, supportsMobileFileShare } from '@/lib/editor/media-transfer';
import { isNativePhotoLibrarySaveAvailable } from '@/lib/native-media';

export function canPrepareWebPhotoShare(): boolean {
  return !isNativePhotoLibrarySaveAvailable() && supportsMobileFileShare();
}

export function usePreparedMediaShare<T>(key: T) {
  const activeKey = useRef(key);
  activeKey.current = key;
  const [prepared, setPrepared] = useState<{ key: T; file: File; showActions: boolean } | null>(null);
  const [shareState, setShareState] = useState<{ file: File; status: 'sharing' | 'failed' } | null>(null);
  const inFlight = useRef<symbol | null>(null);
  if (prepared && prepared.key !== key) setPrepared(null);
  const file = prepared?.key === key ? prepared.file : undefined;
  const status = shareState?.file === file ? shareState?.status : undefined;

  const share = useCallback(async (selected: File | undefined): Promise<boolean> => {
    if (!selected || activeKey.current !== key || inFlight.current) return false;
    const attempt = Symbol();
    inFlight.current = attempt;
    setPrepared({ key, file: selected, showActions: true });
    setShareState({ file: selected, status: 'sharing' });
    const clearSharing = () => {
      if (inFlight.current !== attempt) return;
      inFlight.current = null;
      setShareState(previous => previous?.file === selected && previous.status === 'sharing' ? null : previous);
    };
    const timer = setTimeout(clearSharing, 15_000);
    try {
      // Call synchronously from the tap, or while that tap is still active.
      await navigator.share({ files: [selected] });
      setPrepared(previous => previous?.file === selected ? { ...previous, showActions: false } : previous);
      return true;
    } catch (error) {
      if (inFlight.current === attempt && !(error instanceof Error && error.name === 'AbortError')) {
        setShareState({ file: selected, status: 'failed' });
      }
      return false;
    } finally {
      clearTimeout(timer);
      clearSharing();
    }
  }, [key]);

  const stage = useCallback((blob: Blob, filename: string) => {
    if (activeKey.current !== key || blob.type === 'image/svg+xml') return undefined;
    if (!canPrepareWebPhotoShare()) return undefined;
    return shareableFile(blob, filename);
  }, [key]);

  const warm = useCallback((blob: Blob, filename: string) => {
    const next = stage(blob, filename);
    if (next) setPrepared({ key, file: next, showActions: false });
  }, [key, stage]);

  const offer = useCallback((blob: Blob, filename: string, onShared?: () => void): boolean => {
    // An earlier request may have finished after navigation.
    if (activeKey.current !== key) return true;
    const next = stage(blob, filename);
    if (!next) return false;
    if (navigator.userActivation?.isActive) {
      void share(next).then(shared => { if (shared && activeKey.current === key) onShared?.(); });
    } else {
      setPrepared({ key, file: next, showActions: true });
    }
    return true;
  }, [key, share, stage]);

  const isCurrent = useCallback(() => activeKey.current === key, [key]);
  return {
    file,
    showActions: Boolean(file && prepared?.showActions),
    status,
    warm,
    offer,
    share: () => share(file),
    download: () => { if (file) downloadBlob(file, file.name); },
    isCurrent,
  };
}
