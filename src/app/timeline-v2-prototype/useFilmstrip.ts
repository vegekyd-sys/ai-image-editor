'use client';

// Samples evenly spaced frames from a video source, same approach as
// VideoRetakeTimeline (hidden <video> → seek → canvas → JPEG data URL, cached).
// Production: extract this into a shared hook and reuse it in both places.
import { useEffect, useState } from 'react';

export const FRAME_STEP = 0.5; // seconds of source per sampled frame
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function sample(src: string): Promise<string[]> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  if (inflight.has(src)) return inflight.get(src)!;
  const job = new Promise<string[]>((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    const canvas = document.createElement('canvas');
    const frames: string[] = [];
    video.onloadeddata = async () => {
      const h = 120;
      canvas.height = h;
      canvas.width = Math.round((video.videoWidth / video.videoHeight) * h) || 68;
      const ctx = canvas.getContext('2d');
      const count = Math.max(1, Math.ceil(video.duration / FRAME_STEP));
      for (let i = 0; i < count && ctx; i++) {
        await new Promise<void>((done) => {
          video.onseeked = () => done();
          video.currentTime = Math.min(video.duration - 0.05, (i + 0.5) * FRAME_STEP);
        });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.7));
      }
      cache.set(src, frames);
      video.removeAttribute('src');
      video.load();
      resolve(frames);
    };
    video.onerror = () => resolve([]);
    video.src = src;
  });
  inflight.set(src, job);
  return job;
}

export function useFilmstrip(src?: string): string[] {
  const [frames, setFrames] = useState<string[]>(() => (src && cache.get(src)) || []);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    sample(src).then(f => { if (alive) setFrames(f); });
    return () => { alive = false; };
  }, [src]);
  return frames;
}
