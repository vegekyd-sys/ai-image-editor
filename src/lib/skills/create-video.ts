import { filterAndRemapImages, parseTotalDuration } from '../kling';

export interface CreateVideoInput {
  script: string;
  images: string[];          // public URLs only (no base64)
  duration?: number;         // 3, 5, 7, 10, or 15 seconds. Omit for smart mode
  aspectRatio?: string;      // '9:16', '16:9', '1:1'
}

export interface CreateVideoResult {
  success: boolean;
  taskId?: string;
  message: string;
}

export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const { script, images, duration, aspectRatio } = input;

  if (images.length === 0 || images.length > 7) {
    return {
      success: false,
      message: 'Must provide 1-7 images. Provided: ' + images.length,
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
    const { filteredImages, finalPrompt } = filterAndRemapImages(script, images);

    if (filteredImages.length === 0) {
      return {
        success: false,
        message: 'No images referenced in the script. The script should use <<<image_N>>> format.',
      };
    }

    // Resolve duration: explicit > parsed from script > undefined (smart mode)
    const resolvedDuration = duration ?? parseTotalDuration(finalPrompt);

    console.log(`\n🎬 [create_video] ${filteredImages.length}/${images.length} images, duration=${resolvedDuration ?? 'smart'}, aspectRatio=${aspectRatio ?? 'auto'}`);
    console.log(`Script (${finalPrompt.length} chars): ${finalPrompt.slice(0, 150)}...`);

    // Provider routing: Kling direct (default) or PiAPI
    const usePiAPI = process.env.ANIMATE_PROVIDER === 'piapi';
    let taskId: string;

    if (usePiAPI) {
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
