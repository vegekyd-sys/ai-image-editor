'use client';

import { renderMediaOnWeb } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
export const MAX_DURATION = 900; // Upload limit only. Model reference-video limits stay in generate_animation/create-video.
export const MAX_DURATION_TOLERANCE = 1; // Allow tiny container/audio metadata padding over the upload limit
export const MAX_ACCEPTED_DURATION = MAX_DURATION + MAX_DURATION_TOLERANCE;
export const MAX_FRAME_PIXELS = 2_086_876; // SeeDance limit: width × height must not exceed ~1080p
const STORAGE_UPLOAD_MAX_SIZE = 50 * 1024 * 1024; // images bucket limit
const DIRECT_UPLOAD_MAX_SIZE = 48 * 1024 * 1024; // keep direct uploads below Storage's hard limit
const TRANSCODE_TARGET_SIZE = 42 * 1024 * 1024; // leave room for mux/container overhead
const AUDIO_BITRATE = 128_000;
const MIN_VIDEO_BITRATE = 1_200_000;
const MAX_VIDEO_BITRATE = 8_000_000;

export interface VideoUploadResult {
  videoBlob: Blob;      // H.264 MP4 blob ready for upload
  duration: number;     // seconds
  width: number;        // output dimensions
  height: number;
}

/** Extract video metadata (no poster — poster is captured by ImageCanvas onLoadedData) */
async function extractVideoInfo(file: File): Promise<{
  blobUrl: string;
  duration: number;
  width: number;
  height: number;
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

  if (duration > MAX_ACCEPTED_DURATION) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`Video too long (${duration.toFixed(1).replace(/\\.0$/, '')}s). Maximum ${MAX_DURATION}s.`);
  }

  video.pause();
  video.removeAttribute('src');
  video.load();

  return { blobUrl, duration, width, height };
}

/** Check if file is likely H.264 (MP4 or MOV — both use H.264, skip transcode) */
function isLikelyH264(file: File): boolean {
  const type = file.type;
  const name = file.name.toLowerCase();
  return type === 'video/mp4' || type === 'video/quicktime' || name.endsWith('.mp4') || name.endsWith('.mov');
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

function calcUploadVideoBitrate(duration: number): number {
  const availableBitsPerSecond = Math.floor((TRANSCODE_TARGET_SIZE * 8) / Math.max(1, duration));
  const target = availableBitsPerSecond - AUDIO_BITRATE;
  return Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE, target));
}

/**
 * Fast path: decode → scale → H.264 encode with Mediabunny's Conversion
 * pipeline. Unlike the Remotion fallback it does not render every frame
 * through React/canvas, and AAC audio packets are copied instead of re-encoded.
 */
async function transcodeWithMediabunny(
  file: File,
  out: { width: number; height: number },
  videoBitrate: number,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        width: out.width,
        height: out.height,
        fit: 'contain',
        frameRate: 30,
        codec: 'avc',
        bitrate: videoBitrate,
        allowRotationMetadata: false,
        forceTranscode: true,
      },
      audio: { codec: 'aac', bitrate: AUDIO_BITRATE },
    });
    if (!conversion.isValid) {
      throw new Error(`Mediabunny conversion invalid: ${conversion.discardedTracks.map(t => t.reason).join(', ')}`);
    }
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    if (!target.buffer) throw new Error('Mediabunny produced no output');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose?.();
  }
}

/** Legacy transcode path via Remotion renderMediaOnWeb (kept as a fallback). */
async function transcodeWithRemotion(
  blobUrl: string,
  duration: number,
  out: { width: number; height: number },
  videoBitrate: number,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
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
    videoBitrate,
    audioBitrate: AUDIO_BITRATE,
    onProgress: (p) => onProgress?.(p.progress),
    delayRenderTimeoutInMilliseconds: 30000,
  });
  return result.getBlob();
}

/**
 * Process a video file for upload:
 * 1. Extract metadata
 * 2. Transcode to ≤1080p H.264 MP4 when needed (Mediabunny → Remotion fallback)
 * 3. Return a blob ready for Supabase upload
 */
export async function processVideoUpload(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<VideoUploadResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Video too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
  }

  const info = await extractVideoInfo(file);
  const { blobUrl, duration, width, height } = info;
  const out = calcOutputDims(width, height);

  // Fast path: H.264 MP4 under Storage's object limit AND within resolution limit → direct upload
  const needsResize = width * height > MAX_FRAME_PIXELS;
  if (isLikelyH264(file) && file.size <= DIRECT_UPLOAD_MAX_SIZE && !needsResize) {
    console.log(`📹 [video-upload] direct upload (${(file.size / 1024 / 1024).toFixed(1)}MB, ${width}x${height})`);
    URL.revokeObjectURL(blobUrl);
    return { videoBlob: file, duration, width, height };
  }

  console.log(`📹 [video-upload] transcoding ${width}x${height} → ${out.width}x${out.height} (${duration.toFixed(1)}s)`);
  onProgress?.(0);
  const videoBitrate = calcUploadVideoBitrate(duration);
  const startedAt = performance.now();

  try {
    let videoBlob: Blob | null = null;
    try {
      videoBlob = await transcodeWithMediabunny(file, out, videoBitrate, onProgress);
      console.log(`📹 [video-upload] mediabunny transcode done: ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.warn('📹 [video-upload] mediabunny transcode failed, falling back to Remotion:', err);
    }
    if (!videoBlob) {
      try {
        videoBlob = await transcodeWithRemotion(blobUrl, duration, out, videoBitrate, onProgress);
        console.log(`📹 [video-upload] remotion transcode done: ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
      } catch (err) {
        // Browsers without H.264 WebCodecs encoding: an original file that
        // already fits Storage is better than a failed upload.
        if (file.size <= DIRECT_UPLOAD_MAX_SIZE) {
          console.warn('📹 [video-upload] transcode unavailable, uploading original:', err);
          return { videoBlob: file, duration, width, height };
        }
        throw err;
      }
    }
    if (videoBlob.size > STORAGE_UPLOAD_MAX_SIZE) {
      throw new Error(`Video upload too large after processing (${Math.round(videoBlob.size / 1024 / 1024)}MB). Maximum ${Math.round(STORAGE_UPLOAD_MAX_SIZE / 1024 / 1024)}MB.`);
    }
    return { videoBlob, duration, width: out.width, height: out.height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Extract poster frame from a video file (lightweight, no transcode). */
export async function extractVideoPoster(file: File): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = blobUrl;
  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => resolve();
    setTimeout(resolve, 5000);
  });
  video.currentTime = Math.min(0.5, video.duration * 0.1);
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    setTimeout(resolve, 3000);
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const poster = canvas.toDataURL('image/jpeg', 0.75);
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(blobUrl);
  return poster;
}

export type VideoUploadStage = 'transcode' | 'upload';

/**
 * Process + upload a video file to Supabase Storage.
 * Returns poster + storage URL (does NOT create timeline snapshot).
 * Used by CUI attachment flow where snapshot creation happens on send.
 * `onProgress(progress, stage)` reports 0–1 per stage.
 */
export async function uploadVideoToStorage(
  file: File,
  projectId: string,
  onProgress?: (progress: number, stage: VideoUploadStage) => void,
  prepared?: VideoUploadResult | Promise<VideoUploadResult>,
): Promise<{ videoUrl: string; duration: number; width: number; height: number }> {
  const result = await (prepared ?? processVideoUpload(file, p => onProgress?.(p, 'transcode')));

  const { createClient } = await import('@/lib/supabase/client');
  const { uploadBlobWithProgress } = await import('@/lib/supabase/storage');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const fileId = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const storagePath = `${userId}/${projectId}/videos/upload-${fileId}.mp4`;
  onProgress?.(0, 'upload');
  const videoUrl = await uploadBlobWithProgress(supabase, storagePath, result.videoBlob, 'video/mp4', p => onProgress?.(p, 'upload'));

  return { videoUrl, duration: result.duration, width: result.width, height: result.height };
}
