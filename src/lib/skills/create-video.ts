import { filterAndRemapImages, parseTotalDuration } from '../kling';
import type { VideoModel } from '@/types';

export interface CreateVideoInput {
  script: string;
  images: string[];          // public URLs only (no base64)
  duration?: number;         // 3, 5, 7, 10, or 15 seconds. Omit for smart mode
  aspectRatio?: string;      // '9:16', '16:9', '1:1'
  videoModel?: VideoModel;   // 'kling' (default) or 'seedance'
  // Video editing (Kling only)
  videoUrl?: string;                    // Reference video URL
  videoReferType?: 'base' | 'feature';  // default: 'base'
  keepOriginalSound?: boolean;          // default: false
}

export interface CreateVideoResult {
  success: boolean;
  taskId?: string;
  message: string;
}

export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const { script, images, duration, aspectRatio, videoModel, videoUrl, videoReferType, keepOriginalSound } = input;

  if (images.length === 0) {
    return {
      success: false,
      message: 'No images provided.',
    };
  }

  // Validate images are URLs (not base64)
  for (let i = 0; i < images.length; i++) {
    if (!images[i].startsWith('http://') && !images[i].startsWith('https://')) {
      return {
        success: false,
        message: `Image ${i + 1} must be a publicly accessible URL (not base64 or local path). Please upload images to storage first.`,
      };
    }
  }

  try {
    // Filter to only referenced images and remap indices
    // filterAndRemapImages will enforce the 7-image limit on the filtered result
    const { filteredImages, finalPrompt } = filterAndRemapImages(script, images);

    if (filteredImages.length === 0 && images.length > 0) {
      return {
        success: false,
        message: `No images referenced in the script but ${images.length} images were provided. Use <<<image_1>>> etc. to reference them in your prompt.`,
      };
    }

    // Resolve duration: explicit > parsed from script > undefined (smart mode)
    const resolvedDuration = duration ?? parseTotalDuration(finalPrompt);

    // Provider routing: explicit videoModel > env var > default kling
    let provider: string;
    if (videoModel === 'seedance') {
      provider = 'seedance';
    } else if (videoModel === 'kling') {
      provider = 'kling';
    } else {
      provider = process.env.ANIMATE_PROVIDER || 'kling';
    }

    console.log(`\n🎬 [create_video] provider=${provider}, ${filteredImages.length}/${images.length} images, duration=${resolvedDuration ?? 'smart'}, aspectRatio=${aspectRatio ?? 'auto'}${videoUrl ? `, video=${videoReferType ?? 'base'}` : ''}`);
    console.log(`Script (${finalPrompt.length} chars): ${finalPrompt.slice(0, 150)}...`);

    let taskId: string;

    // Video editing (base mode) only supported by Kling
    if (videoUrl && videoReferType === 'base' && provider !== 'kling') {
      return {
        success: false,
        message: `Video editing (base mode) is only supported by Kling. Current model: ${provider}`,
      };
    }
    if (videoUrl && provider === 'piapi') {
      return {
        success: false,
        message: 'Video reference is not supported by PiAPI provider.',
      };
    }

    if (provider === 'seedance') {
      const { createSeedanceTask } = await import('../seedance');
      taskId = await createSeedanceTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration != null ? resolvedDuration : -1,
        ratio: aspectRatio || 'adaptive',
        resolution: '720p',
        videoUrl,
      });
      console.log(`✅ [create_video] SeeDance task created: ${taskId}`);
    } else if (provider === 'piapi') {
      const { createKlingTask: createKlingTaskPiAPI } = await import('../piapi');
      taskId = await createKlingTaskPiAPI({
        prompt: finalPrompt.replace(/<<<image_(\d+)>>>/g, '@image_$1'), // PiAPI format
        images: filteredImages,
        duration: resolvedDuration ?? 10,
        aspect_ratio: aspectRatio ?? '9:16',
        enable_audio: true,
        version: '3.0',
      });
      console.log(`✅ [create_video] PiAPI task created: ${taskId}`);
    } else {
      const { createKlingTask, detectAspectRatio } = await import('../kling');
      const resolvedRatio = aspectRatio || await detectAspectRatio(filteredImages[0] || images[0]);
      taskId = await createKlingTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration,
        aspect_ratio: resolvedRatio,
        videoUrl,
        videoReferType,
        keepOriginalSound,
      });
      console.log(`✅ [create_video] Kling task created: ${taskId}`);
    }

    return {
      success: true,
      taskId,
      message: `Video rendering task created. Task ID: ${taskId}. Rendering takes 3-5 minutes. Use makaron_get_video_status to poll.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create_video error]', msg);
    return {
      success: false,
      message: `Video creation error: ${msg}`,
    };
  }
}
