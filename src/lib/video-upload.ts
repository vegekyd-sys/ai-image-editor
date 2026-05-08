'use client';

import { renderMediaOnWeb } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import { createVideoDesign } from '@/lib/video-design';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_DURATION = 60; // 60 seconds
const TARGET_SHORT_EDGE = 1080;
const MAX_FRAME_PIXELS = 2_086_876; // SeeDance limit: width × height must not exceed this
const DIRECT_UPLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100MB — skip transcode for any H.264 MP4

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

/** Calculate output dimensions (max ~1080p, preserve aspect ratio, even numbers) */
function calcOutputDims(w: number, h: number): { width: number; height: number } {
  const pixels = w * h;
  if (pixels <= MAX_FRAME_PIXELS) return { width: w, height: h };
  // Scale down so frame pixels fit within limit (floor to stay under)
  const scale = Math.sqrt(MAX_FRAME_PIXELS / pixels) * 0.99;
  return {
    width: Math.floor(w * scale / 2) * 2,
    height: Math.floor(h * scale / 2) * 2,
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

  // Fast path: H.264 MP4 under size limit AND within resolution limit → direct upload
  const needsResize = width * height > MAX_FRAME_PIXELS;
  if (isLikelyH264Mp4(file) && file.size <= DIRECT_UPLOAD_MAX_SIZE && !needsResize) {
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
      <Video src="${blobUrl}" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

/**
 * Process + upload a video file to Supabase Storage.
 * Returns poster + storage URL (does NOT create timeline snapshot).
 * Used by CUI attachment flow where snapshot creation happens on send.
 */
export async function uploadVideoToStorage(
  file: File,
  projectId: string,
  onProgress?: (progress: number) => void,
): Promise<{ poster: string; videoUrl: string; duration: number; width: number; height: number }> {
  const result = await processVideoUpload(file, onProgress);

  // Upload to Supabase
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const fileId = crypto.randomUUID();
  const storagePath = `${user.id}/${projectId}/videos/upload-${fileId}.mp4`;
  const { error } = await supabase.storage.from('images')
    .upload(storagePath, result.videoBlob, { contentType: 'video/mp4', upsert: true });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);
  const videoUrl = urlData?.publicUrl || '';

  return { poster: result.poster, videoUrl, duration: result.duration, width: result.width, height: result.height };
}
