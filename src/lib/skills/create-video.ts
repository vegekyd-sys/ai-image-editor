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
  // Motion Control (Kling only)
  motionControl?: boolean;              // Use /v1/videos/motion-control endpoint
  characterOrientation?: 'image' | 'video';  // default: 'image'
}

export interface CreateVideoResult {
  success: boolean;
  taskId?: string;
  message: string;
}

export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const { script, images, duration, aspectRatio, videoModel, videoUrl, videoReferType, keepOriginalSound, motionControl, characterOrientation } = input;

  if (images.length === 0) {
    return {
      success: false,
      message: 'No images provided.',
    };
  }

  try {
    // Motion Control: separate path — single image + video, no image references needed
    if (motionControl) {
      if (!videoUrl) {
        return { success: false, message: 'Motion Control requires a reference video (videoUrl).' };
      }
      const firstImage = images[0];
      if (!firstImage?.startsWith('http')) {
        return { success: false, message: 'Motion Control requires the first image to be a publicly accessible URL. It may still be uploading — wait and retry.' };
      }
      const { createKlingMotionControlTask } = await import('../kling');
      const taskId = await createKlingMotionControlTask({
        imageUrl: firstImage,
        videoUrl,
        prompt: script,
        keepOriginalSound: keepOriginalSound !== false,
        characterOrientation: characterOrientation || 'image',
      });
      console.log(`✅ [create_video] Motion Control task created: mc-${taskId}`);
      return {
        success: true,
        taskId: `mc-${taskId}`,
        message: `Motion Control video task created. Task ID: mc-${taskId}. Duration matches reference video. Use makaron_get_video_status to poll.`,
      };
    }

    // Filter to only referenced images and remap indices (preserves index alignment)
    // filterAndRemapImages will enforce the 7-image limit on the filtered result
    const { filteredImages, finalPrompt } = filterAndRemapImages(script, images);

    if (filteredImages.length === 0 && images.length > 0) {
      return {
        success: false,
        message: `No images referenced in the script but ${images.length} images were provided. Use <<<image_1>>> etc. to reference them in your prompt.`,
      };
    }

    // Validate only referenced images are URLs (unreferenced positions may be empty/base64 — that's fine)
    for (let i = 0; i < filteredImages.length; i++) {
      if (!filteredImages[i]?.startsWith('http')) {
        return {
          success: false,
          message: `Referenced image ${i + 1} is not a publicly accessible URL — it may still be uploading to storage. Please wait a moment and try again.`,
        };
      }
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
      const { createEvolinkTask } = await import('../evolink');
      taskId = await createEvolinkTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration != null ? resolvedDuration : undefined,
        aspectRatio: aspectRatio || 'adaptive',
        quality: '720p',
        videoUrls: videoUrl ? [videoUrl] : undefined,
      });
      console.log(`✅ [create_video] SeeDance (Evolink) task created: ${taskId}`);
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
