'use client';

import { renderMediaOnWeb } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import { createVideoDesign } from '@/lib/video-design';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_DURATION = 60; // 60 seconds
const TARGET_SHORT_EDGE = 720;
const DIRECT_UPLOAD_MAX_SIZE = 30 * 1024 * 1024; // 30MB — skip transcode if small H.264

export interface VideoUploadResult {
  poster: string;       // base64 JPEG data URL
  videoBlob: Blob;      // H.264 MP4 blob ready for upload
  duration: number;     // seconds
  width: number;        // output dimensions
  height: number;
}

/** Extract video metadata + poster frame */
async function extractVideoInfo(file: File): Promise<{
  blobUrl: string;
  duration: number;
  width: number;
  height: number;
  poster: string;
}> {
  const blobUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = blobUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Cannot read video file'));
    setTimeout(() => reject(new Error('Video metadata timeout')), 10000);
  });

  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (duration > MAX_DURATION) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`Video too long (${Math.round(duration)}s). Maximum ${MAX_DURATION}s.`);
  }

  // Seek to 0.5s for poster (avoid black first frame)
  video.currentTime = Math.min(0.5, duration * 0.1);
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    setTimeout(resolve, 3000);
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);
  const poster = canvas.toDataURL('image/jpeg', 0.85);

  video.pause();
  video.removeAttribute('src');
  video.load();

  return { blobUrl, duration, width, height, poster };
}

/** Check if file is likely H.264 MP4 (can skip transcode) */
function isLikelyH264Mp4(file: File): boolean {
  return file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
}

/** Calculate output dimensions (720p, preserve aspect ratio, even numbers) */
function calcOutputDims(w: number, h: number): { width: number; height: number } {
  const shortEdge = Math.min(w, h);
  if (shortEdge <= TARGET_SHORT_EDGE) return { width: w, height: h };
  const scale = TARGET_SHORT_EDGE / shortEdge;
  return {
    width: Math.round(w * scale / 2) * 2,
    height: Math.round(h * scale / 2) * 2,
  };
}

/**
 * Process a video file for upload:
 * 1. Extract poster + metadata
 * 2. Transcode to 720p H.264 MP4 via Remotion (if needed)
 * 3. Return poster + blob ready for Supabase upload
 */
export async function processVideoUpload(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<VideoUploadResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Video too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
  }

  const info = await extractVideoInfo(file);
  const { blobUrl, duration, width, height, poster } = info;
  const out = calcOutputDims(width, height);

  // Fast path: small H.264 MP4 at reasonable resolution → direct upload
  if (isLikelyH264Mp4(file) && file.size <= DIRECT_UPLOAD_MAX_SIZE && width <= 1920 && height <= 1920) {
    console.log(`📹 [video-upload] direct upload (${(file.size / 1024 / 1024).toFixed(1)}MB, ${width}x${height})`);
    URL.revokeObjectURL(blobUrl);
    return { poster, videoBlob: file, duration, width, height };
  }

  // Transcode via Remotion renderMediaOnWeb
  console.log(`📹 [video-upload] transcoding ${width}x${height} → ${out.width}x${out.height} (${duration.toFixed(1)}s)`);
  onProgress?.(0);

  try {
    await preloadBabel().catch(() => {});

    const code = `function Design() {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video src="${blobUrl}" muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}`;
    const Component = evalRemotionJSX(code);
    if (!Component) throw new Error('Failed to compile transcode wrapper');

    const fps = 30;
    const durationInFrames = Math.max(1, Math.round(fps * duration));

    const result = await renderMediaOnWeb({
      composition: {
        component: Component,
        durationInFrames,
        fps,
        width: out.width,
        height: out.height,
        id: 'video-upload-transcode',
        calculateMetadata: null,
        defaultProps: {},
      },
      inputProps: {},
      videoCodec: 'h264',
      container: 'mp4',
      onProgress: (p) => onProgress?.(p.progress),
      delayRenderTimeoutInMilliseconds: 30000,
    });

    const videoBlob = await result.getBlob();
    console.log(`📹 [video-upload] transcode done: ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB`);

    return { poster, videoBlob, duration, width: out.width, height: out.height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
