'use client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { isHeicFile, ensureDecodableFile } from '@/lib/imageUtils';
import { createLimiter, isVideoFile, prepareMedia, type MediaItemState } from '@/lib/upload/media-queue';

const MAX_FILES = 10;

// HEIC decode is CPU heavy (WASM); run a couple at a time instead of
// blocking every later file behind the previous conversion.
const heicLimiter = createLimiter(3);

function newDraftProjectId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
}

/**
 * @param userId When signed in, each attachment starts uploading to the draft
 *   project's storage folder as soon as it is attached, so tapping create only
 *   has to wait for whatever is still in flight. Anonymous users only prepare
 *   locally (they upload after login via the staged-media flow).
 */
export function useCreateInput(userId?: string | null) {
  const [files, setFiles] = useState<File[]>([]);
  // Keyed by a per-attachment id so async poster/HEIC/progress updates land on
  // the right file even when several finish out of order.
  const [previewById, setPreviewById] = useState<Record<string, string | null>>({});
  const [stateById, setStateById] = useState<Record<string, MediaItemState>>({});
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardDragX, setCardDragX] = useState(0);
  const idsRef = useRef(new WeakMap<File, string>());
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const draftProjectIdRef = useRef<string>(newDraftProjectId());

  const idOf = useCallback((file: File): string => {
    let id = idsRef.current.get(file);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      idsRef.current.set(file, id);
    }
    return id;
  }, []);

  const setFileState = useCallback((file: File, state: MediaItemState) => {
    const id = idsRef.current.get(file);
    if (!id) return;
    setStateById(prev => {
      const current = prev[id];
      // Avoid a re-render storm from sub-percent progress ticks.
      if (current && current.status === state.status && current.phase === state.phase
        && Math.abs(current.progress - state.progress) < 0.01 && current.error === state.error) return prev;
      return { ...prev, [id]: state };
    });
  }, []);

  const userIdRef = useRef(userId ?? null);
  userIdRef.current = userId ?? null;

  const startPrepare = useCallback((file: File) => {
    if (file.size === 0) return; // restored-draft placeholders are already uploaded URLs
    const onState = (state: MediaItemState) => setFileState(file, state);
    const uid = userIdRef.current;
    if (!uid) {
      prepareMedia(file, onState).catch(() => { /* surfaced via state */ });
      return;
    }
    const projectId = draftProjectIdRef.current;
    void Promise.all([import('@/lib/createProject'), import('@/lib/supabase/client')])
      .then(([{ preuploadCreateMedia }, { createClient }]) =>
        preuploadCreateMedia(createClient(), uid, projectId, file, onState))
      .catch(() => { /* surfaced via state */ });
  }, [setFileState]);

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const room = MAX_FILES - filesRef.current.length;
    const accepted = newFiles.slice(0, Math.max(0, room));
    if (accepted.length === 0) return;

    // Show every attachment immediately; previews fill in as they decode.
    const initialPreviews: Record<string, string | null> = {};
    for (const file of accepted) {
      const id = idOf(file);
      initialPreviews[id] = isVideoFile(file) || isHeicFile(file) ? null : URL.createObjectURL(file);
    }
    setPreviewById(prev => ({ ...prev, ...initialPreviews }));
    setFiles(prev => [...prev, ...accepted].slice(0, MAX_FILES));
    setCardIndex(999);

    await Promise.all(accepted.map(async (file) => {
      const id = idOf(file);
      if (isVideoFile(file)) {
        startPrepare(file);
        try {
          const { extractVideoPoster } = await import('@/lib/video-upload');
          const poster = await extractVideoPoster(file);
          setPreviewById(prev => (id in prev ? { ...prev, [id]: poster } : prev));
        } catch { /* keep placeholder */ }
        return;
      }
      if (isHeicFile(file)) {
        setFileState(file, { status: 'processing', progress: 0 });
        try {
          const decodable = await heicLimiter(() => ensureDecodableFile(file));
          idsRef.current.set(decodable, id);
          const previewUrl = URL.createObjectURL(decodable);
          setFiles(prev => prev.map(f => (f === file ? decodable : f)));
          setPreviewById(prev => (id in prev ? { ...prev, [id]: previewUrl } : prev));
          startPrepare(decodable);
        } catch {
          setPreviewById(prev => (id in prev ? { ...prev, [id]: 'heic-pending' } : prev));
          // compressCreateImageFile still has the server conversion fallback.
          startPrepare(file);
        }
        return;
      }
      startPrepare(file);
    }));
  }, [idOf, setFileState, startPrepare]);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => {
      const removed = prev[index];
      if (removed) {
        const id = idsRef.current.get(removed);
        if (id) {
          setPreviewById(p => { const next = { ...p }; delete next[id]; return next; });
          setStateById(p => { const next = { ...p }; delete next[id]; return next; });
        }
      }
      return prev.filter((_, j) => j !== index);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    for (const file of filesRef.current) {
      // HEIC originals still decoding start themselves once decoded.
      if (!isHeicFile(file)) startPrepare(file);
    }
  }, [userId, startPrepare]);

  /** Re-run preparation for a failed attachment. */
  const retryFile = useCallback((index: number) => {
    const file = filesRef.current[index];
    if (!file) return;
    // Failed prepare/upload entries drop themselves from their caches, so this
    // re-runs only the failed step (a finished transcode is reused).
    startPrepare(file);
  }, [startPrepare]);

  const restoreDraftImages = useCallback((images: string[]) => {
    if (images.length === 0) return;
    const placeholders = images.slice(0, MAX_FILES).map((_, index) =>
      new File([], `restored-draft-${index + 1}.jpg`, { type: 'image/jpeg' })
    );
    const nextPreviews: Record<string, string | null> = {};
    placeholders.forEach((file, i) => { nextPreviews[idOf(file)] = images[i]; });
    setFiles(placeholders);
    setPreviewById(nextPreviews);
    setStateById({});
    setCardIndex(999);
  }, [idOf]);

  const clear = useCallback(() => {
    setFiles([]);
    setPreviewById({});
    setStateById({});
    setText('');
    draftProjectIdRef.current = newDraftProjectId();
  }, []);

  /** A created project must never be reused by the next draft. */
  const rotateDraftProjectId = useCallback(() => {
    draftProjectIdRef.current = newDraftProjectId();
  }, []);

  const previews = useMemo(
    () => files.map(file => previewById[idsRef.current.get(file) ?? ''] ?? null),
    [files, previewById],
  );
  const itemStates = useMemo(
    () => files.map(file => stateById[idsRef.current.get(file) ?? '']),
    [files, stateById],
  );

  const submit = useCallback(async (handler: (files: File[], text?: string) => Promise<void>) => {
    setCreating(true);
    try {
      await handler(files, text.trim() || undefined);
      clear();
    } catch (err) {
      setCreating(false);
      throw err;
    }
  }, [files, text, clear]);

  return {
    files, previews, itemStates, text, setText, creating, setCreating,
    fileInputRef, cardIndex, setCardIndex, cardDragX, setCardDragX,
    addFiles, removeFile, retryFile, restoreDraftImages, clear, submit,
    setFileState, draftProjectIdRef, rotateDraftProjectId,
    preuploading: Boolean(userId),
  };
}

export type CreateInputState = ReturnType<typeof useCreateInput>;
