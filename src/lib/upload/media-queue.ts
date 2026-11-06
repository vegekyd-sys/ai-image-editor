'use client';

/**
 * Shared client-side media preparation + upload queue.
 *
 * Home and CUI attachments both go through here so that:
 * - preparation (HEIC decode, image resize, video transcode) starts as soon as
 *   a file is attached instead of after the user taps send;
 * - heavy work runs with bounded concurrency (one video transcode at a time,
 *   a couple of image decodes) so phones don't stall or run out of memory;
 * - every file reports a visible state the UI can render.
 */
import type { VideoUploadResult } from '@/lib/video-upload';

export type MediaItemStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error';

export interface MediaItemState {
  status: MediaItemStatus;
  /** 0–1 progress of the current status (processing or uploading). */
  progress: number;
  /** 'transcode' while a video is being re-encoded; undefined otherwise. */
  phase?: 'transcode';
  error?: string;
}

export type PreparedMedia =
  | { kind: 'image'; payload: string }
  | { kind: 'video'; result: VideoUploadResult };

export function isVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
}

/** Minimal FIFO semaphore. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// One transcode at a time: hardware encoders are a shared resource and two
// parallel 1080p encodes on a phone are slower than two sequential ones.
const videoLimiter = createLimiter(1);
const imageLimiter = createLimiter(2);
export const uploadLimiter = createLimiter(3);

type ProgressListener = (state: MediaItemState) => void;

interface PrepareEntry {
  promise: Promise<PreparedMedia>;
  listeners: Set<ProgressListener>;
  last: MediaItemState;
}

const prepareCache = new WeakMap<File, PrepareEntry>();

function emit(entry: PrepareEntry, state: MediaItemState) {
  entry.last = state;
  for (const listener of entry.listeners) listener(state);
}

/**
 * Start (or join) local preparation for a file. Safe to call repeatedly: the
 * same File shares one in-flight promise, and late subscribers immediately
 * receive the latest state.
 */
export function prepareMedia(file: File, onState?: ProgressListener): Promise<PreparedMedia> {
  const existing = prepareCache.get(file);
  if (existing) {
    if (onState) {
      existing.listeners.add(onState);
      onState(existing.last);
    }
    return existing.promise;
  }

  const entry: PrepareEntry = {
    promise: Promise.resolve() as unknown as Promise<PreparedMedia>,
    listeners: new Set(onState ? [onState] : []),
    last: { status: 'processing', progress: 0 },
  };
  prepareCache.set(file, entry);
  emit(entry, entry.last);

  entry.promise = (async (): Promise<PreparedMedia> => {
    if (isVideoFile(file)) {
      const result = await videoLimiter(async () => {
        const { processVideoUpload } = await import('@/lib/video-upload');
        return processVideoUpload(file, progress => {
          emit(entry, { status: 'processing', progress, phase: 'transcode' });
        });
      });
      return { kind: 'video', result };
    }
    const payload = await imageLimiter(async () => {
      const { compressCreateImageFile } = await import('@/lib/createProject');
      return compressCreateImageFile(file);
    });
    return { kind: 'image', payload };
  })();

  entry.promise.then(
    () => emit(entry, { status: 'ready', progress: 1 }),
    (err: unknown) => {
      // Let a retry start from scratch.
      prepareCache.delete(file);
      emit(entry, { status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) });
    },
  );
  return entry.promise;
}

/** Stop forwarding progress for a file (e.g. after it was removed from the UI). */
export function unsubscribePrepare(file: File, onState: ProgressListener) {
  prepareCache.get(file)?.listeners.delete(onState);
}

export function forgetPreparedMedia(file: File) {
  prepareCache.delete(file);
}

/** Run a video transcode under the shared video limiter (used by CUI). */
export function prepareVideo(file: File, onProgress?: (progress: number) => void): Promise<VideoUploadResult> {
  return prepareMedia(file, state => {
    if (state.status === 'processing') onProgress?.(state.progress);
  }).then(prepared => {
    if (prepared.kind !== 'video') throw new Error('Not a video file');
    return prepared.result;
  });
}

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  uploading: boolean;
}

export function summarizeStates(states: Array<MediaItemState | undefined>): UploadSummary {
  let done = 0;
  let failed = 0;
  let uploading = false;
  for (const state of states) {
    if (!state) continue;
    if (state.status === 'done') done += 1;
    else if (state.status === 'error') failed += 1;
    else if (state.status === 'uploading') uploading = true;
  }
  return { total: states.length, done, failed, uploading };
}
