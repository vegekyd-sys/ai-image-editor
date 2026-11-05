'use client';

// Evenly spaced frames of a video source for timeline filmstrips. Same
// sampling approach as VideoRetakeTimeline (hidden <video> → seek → canvas →
// JPEG), with the existing range proxy as the CORS fallback. Frames are
// cached per source for the session so trims, zoom and remounts are instant.
import { useEffect, useState } from 'react';
import { buildVideoProxyUrl } from '@/lib/video-playback-url';

export const FRAME_STEP = 0.5; // seconds of source per sampled frame
const MAX_FRAMES = 240;
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();
const listeners = new Map<string, Set<(frames: string[]) => void>>();

function notify(src: string, frames: string[]) {
  listeners.get(src)?.forEach(fn => fn(frames));
}

function sampleFrom(url: string, key: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous';
    const canvas = document.createElement('canvas');
    const frames: string[] = [];
    const cleanup = () => { video.removeAttribute('src'); video.load(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('load timeout')); }, 15000);
    video.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('load error')); };
    video.onloadeddata = async () => {
      clearTimeout(timeout);
      try {
        const h = 96;
        canvas.height = h;
        canvas.width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * h)) || 54;
        const ctx = canvas.getContext('2d');
        const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(video.duration / FRAME_STEP)));
        for (let i = 0; i < count && ctx; i++) {
          await new Promise<void>((done, fail) => {
            const t = setTimeout(() => fail(new Error('seek timeout')), 8000);
            video.onseeked = () => { clearTimeout(t); done(); };
            video.currentTime = Math.min(Math.max(0, video.duration - 0.05), (i + 0.5) * FRAME_STEP);
          });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL('image/jpeg', 0.7)); // throws on tainted canvas → proxy fallback
          if (i % 6 === 5) { cache.set(key, [...frames]); notify(key, [...frames]); }
        }
        cleanup();
        resolve(frames);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    video.src = url;
  });
}

function sample(src: string): Promise<string[]> {
  const done = cache.get(src);
  if (done && inflight.get(src) === undefined && done.length) return Promise.resolve(done);
  const existing = inflight.get(src);
  if (existing) return existing;
  const job = sampleFrom(src, src)
    .catch(() => (/^https?:/i.test(src) ? sampleFrom(buildVideoProxyUrl(src), src) : []))
    .catch(() => [] as string[])
    .then(frames => { cache.set(src, frames); notify(src, frames); inflight.delete(src); return frames; });
  inflight.set(src, job);
  return job;
}

export function useVideoFilmstrip(src: string | undefined): string[] {
  const [frames, setFrames] = useState<string[]>(() => (src && cache.get(src)) || []);
  useEffect(() => {
    if (!src) return;
    setFrames(cache.get(src) || []);
    const set = listeners.get(src) || new Set();
    set.add(setFrames);
    listeners.set(src, set);
    void sample(src);
    return () => { set.delete(setFrames); };
  }, [src]);
  return frames;
}
