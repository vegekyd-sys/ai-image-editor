import { filterAndRemapImages, parseTotalDuration } from '../kling';

export interface CreateVideoInput {
  script: string;
  images: string[];          // public URLs only (no base64)
  duration?: number;         // 3, 5, 7, 10, or 15 seconds. Omit for smart mode
  aspectRatio?: string;      // '9:16', '16:9', '1:1'
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
  const { script, images, duration, aspectRatio, videoUrl, videoReferType, keepOriginalSound } = input;
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

    if (filteredImages.length === 0) {
      return {
        success: false,
        message: 'No images referenced in the script. The script should use <<<image_N>>> format.',
      };
    }

    // Resolve duration: explicit > parsed from script > undefined (smart mode)
    const resolvedDuration = duration ?? parseTotalDuration(finalPrompt);

    console.log(`\n🎬 [create_video] ${filteredImages.length}/${images.length} images, duration=${resolvedDuration ?? 'smart'}, aspectRatio=${aspectRatio ?? 'auto'}${videoUrl ? `, video=${videoReferType ?? 'base'}` : ''}`);
    console.log(`Script (${finalPrompt.length} chars): ${finalPrompt.slice(0, 150)}...`);

    // Provider routing: foldin, piapi, or kling (default)
    const provider = process.env.ANIMATE_PROVIDER || 'kling';
    let taskId: string;

    // Video editing only supported by Kling direct
    if (videoUrl && provider !== 'kling') {
      return {
        success: false,
        message: `Video editing (video_list) is only supported by Kling direct provider. Current provider: ${provider}`,
      };
    }

    if (provider === 'foldin') {
      const { createFoldinTask } = await import('../foldin');
      // Foldin understands <<<image_N>>> markers directly, keep them
      taskId = await createFoldinTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration,
        ratio: aspectRatio,
        resolution: '720P',
      });
      console.log(`✅ [create_video] Foldin task created: ${taskId}`);
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
      const { createKlingTask } = await import('../kling');
      taskId = await createKlingTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration,
        aspect_ratio: aspectRatio,
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
