import { filterAndRemapImages, parseTotalDuration } from '../kling';
import { getVideoModelCapability, normalizeVideoModelId, resolveClosestSupportedAspectRatio, resolveVideoGenerationRoute, resolveVideoOutputDuration, resolveVideoProviderAspectRatio, validateVideoModelRequest, type VideoAspectRatioInput, type VideoReferenceMeta, type VideoResolutionInput } from '@/lib/video-model-capabilities';

const MAX_REFERENCE_VIDEO_PROBE_BYTES = 55 * 1024 * 1024;

export interface CreateVideoInput {
  script: string;
  images: string[];          // public URLs only (no base64)
  duration?: number;         // 3, 5, 7, 10, or 15 seconds. Omit for smart mode
  aspectRatio?: VideoAspectRatioInput;
  videoModel?: string;       // video provider/model id, e.g. 'kling' or 'seedance'
  videoResolution?: VideoResolutionInput;
  // Video editing (Kling only)
  videoUrl?: string;                    // Reference video URL (explicit from agent)
  videoReferType?: 'base' | 'feature';  // default: 'base'
  videoUrls?: string[];                 // Auto-detected video references from timeline
  referenceVideoDuration?: number;       // Timeline video duration; output should match when editing video
  referenceVideoMetas?: VideoReferenceMeta[];
  keepOriginalSound?: boolean;          // default: false
  // Motion Control (Kling only)
  motionControl?: boolean;              // Use /v1/videos/motion-control endpoint
  characterOrientation?: 'image' | 'video';  // default: 'image'
}

export interface CreateVideoResult {
  success: boolean;
  taskId?: string;
  videoModel?: string;
  providerModel?: string;
  message: string;
}

function resolveEvolinkProviderModel(provider: string, fallbackModel: string | undefined, imageCount: number, hasVideoReference: boolean): string | undefined {
  const base =
    provider === 'seedance-mini' ? 'seedance-2.0-mini'
    : provider === 'seedance-fast' ? 'seedance-2.0-fast'
    : provider === 'seedance' ? 'seedance-2.0'
    : undefined;
  if (!base) return fallbackModel;
  if (hasVideoReference || imageCount > 2) return `${base}-reference-to-video`;
  if (imageCount > 0) return `${base}-image-to-video`;
  return `${base}-text-to-video`;
}

async function probeReferenceVideoMeta(url: string): Promise<VideoReferenceMeta | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_REFERENCE_VIDEO_PROBE_BYTES) return { fileSizeBytes: contentLength };

    const buffer = new Uint8Array(await res.arrayBuffer());
    const { probeMP4Dimensions } = await import('../mp4-probe');
    const dims = probeMP4Dimensions(buffer);
    return {
      ...(dims || {}),
      fileSizeBytes: contentLength || buffer.length,
    };
  } catch {
    return null;
  }
}

async function fillReferenceVideoMetas(urls: string[], metas?: VideoReferenceMeta[]): Promise<VideoReferenceMeta[] | undefined> {
  if (!urls.length && !metas?.length) return metas;
  const next = [...(metas || [])];
  for (let i = 0; i < urls.length; i++) {
    const current = next[i] || {};
    const hasDimensions = Number(current.width) > 0 && Number(current.height) > 0;
    const hasSize = Number(current.fileSizeBytes) > 0;
    if (hasDimensions && hasSize) continue;
    const probed = await probeReferenceVideoMeta(urls[i]);
    next[i] = probed ? { ...current, ...probed } : current;
  }
  return next.length ? next : undefined;
}

function resolveSeedanceReferenceAspectRatio(
  provider: string,
  aspectRatio: VideoAspectRatioInput,
  hasVideoReference: boolean,
  metas?: VideoReferenceMeta[],
): string | undefined {
  if (aspectRatio && aspectRatio !== 'auto') return resolveVideoProviderAspectRatio(provider, aspectRatio);
  if (hasVideoReference) {
    const firstWithDimensions = metas?.find(meta => Number(meta.width) > 0 && Number(meta.height) > 0);
    const inferred = resolveClosestSupportedAspectRatio(provider, firstWithDimensions?.width, firstWithDimensions?.height);
    if (inferred) return inferred;
  }
  return resolveVideoProviderAspectRatio(provider, aspectRatio);
}

export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const { script, images, duration, aspectRatio, videoModel, videoResolution, videoUrl, videoReferType, videoUrls, referenceVideoDuration, referenceVideoMetas, keepOriginalSound, motionControl, characterOrientation } = input;
  const hasVideoReference = !!videoUrl || !!videoUrls?.length;
  const provider = normalizeVideoModelId(videoModel);
  const route = resolveVideoGenerationRoute({ model: provider, resolution: videoResolution });
  const capability = getVideoModelCapability(provider);
  const seedanceVideoUrls = [...(videoUrl ? [videoUrl] : []), ...(videoUrls || [])].filter(Boolean);
  const modelError = validateVideoModelRequest({
    model: provider,
    resolution: route.resolution,
    aspectRatio,
    outputDuration: duration,
    referenceVideoDuration,
    referenceVideoMetas,
    hasVideoReference,
  });

  if (modelError) return { success: false, message: modelError };
  const resolvedReferenceVideoMetas = await fillReferenceVideoMetas(seedanceVideoUrls, referenceVideoMetas);

  if (images.length === 0 && !hasVideoReference) {
    return {
      success: false,
      message: 'No images or video reference provided.',
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

    if (filteredImages.length === 0 && images.length > 0 && !hasVideoReference) {
      return {
        success: false,
        message: `No images referenced in the script but ${images.length} images were provided. Use <<<media_1>>> etc. to reference them in your prompt.`,
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

    // Resolve duration: explicit user choice > video edit source duration > parsed script > smart mode.
    // This prevents accidental 5s edits, while still allowing requests like "turn this 10s video into 8s".
    const resolvedDuration = resolveVideoOutputDuration({
      requestedDuration: duration,
      referenceVideoDuration,
      model: provider,
    }) ?? parseTotalDuration(finalPrompt);

    const filteredModelError = validateVideoModelRequest({
      model: provider,
      resolution: route.resolution,
      aspectRatio,
      outputDuration: resolvedDuration,
      referenceVideoDuration,
      referenceVideoMetas: resolvedReferenceVideoMetas,
      hasVideoReference,
      imageReferenceCount: filteredImages.length,
    });
    if (filteredModelError) return { success: false, message: filteredModelError };

    const loggedVideoRefType = videoUrl ? (videoReferType ?? 'base') : (videoUrls?.length ? 'feature' : undefined);
    const providerAspectRatio = resolveSeedanceReferenceAspectRatio(provider, aspectRatio, seedanceVideoUrls.length > 0, resolvedReferenceVideoMetas);
    console.log(`\n🎬 [create_video] provider=${provider}, resolution=${route.resolution}, ${filteredImages.length}/${images.length} images, duration=${resolvedDuration ?? 'smart'}, aspectRatio=${providerAspectRatio ?? 'auto'}${hasVideoReference ? `, video=${loggedVideoRefType}` : ''}`);
    console.log(`Script (${finalPrompt.length} chars): ${finalPrompt.slice(0, 150)}...`);

    let taskId: string;

    if (videoUrl && videoReferType === 'base' && !capability.supportsBaseVideoEdit) {
      return {
        success: false,
        message: `Video editing (base mode) is not supported by ${capability.label}. Use video_ref_type="feature" or choose a model that supports base video editing.`,
      };
    }
    if (videoUrl && provider === 'piapi') {
      return {
        success: false,
        message: 'Video reference is not supported by PiAPI provider.',
      };
    }

    if (route.provider === 'seedance') {
      const { createEvolinkTask } = await import('../evolink');
      const providerModel = resolveEvolinkProviderModel(provider, route.providerModel, filteredImages.length, seedanceVideoUrls.length > 0);
      taskId = await createEvolinkTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration != null ? resolvedDuration : undefined,
        aspectRatio: providerAspectRatio,
        quality: route.resolution,
        model: providerModel,
        videoUrls: seedanceVideoUrls.length ? seedanceVideoUrls : undefined,
      });
      console.log(`✅ [create_video] SeeDance (Evolink) task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel,
        message: `Video rendering task created. Task ID: ${taskId}. Rendering time depends on the selected model. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'grok') {
      const { createXaiVideoTask } = await import('../xai-video');
      taskId = await createXaiVideoTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration != null ? resolvedDuration : undefined,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '480p' | '720p',
      });
      console.log(`✅ [create_video] Grok Video task created: ${taskId}`);
    } else if (route.provider === 'piapi') {
      const { createKlingTask: createKlingTaskPiAPI } = await import('../piapi');
      taskId = await createKlingTaskPiAPI({
        prompt: finalPrompt.replace(/<<<(?:image|media)_(\d+)>>>/g, '@image_$1'), // PiAPI format
        images: filteredImages,
        duration: resolvedDuration ?? 10,
        aspect_ratio: providerAspectRatio ?? '9:16',
        enable_audio: true,
        version: '3.0',
      });
      console.log(`✅ [create_video] PiAPI task created: ${taskId}`);
    } else if (route.provider === 'kling') {
      const { createKlingTask, detectAspectRatio } = await import('../kling');
      const ratioSourceImage = filteredImages[0] || images[0];
      const resolvedRatio = providerAspectRatio || (ratioSourceImage ? await detectAspectRatio(ratioSourceImage) : undefined);
      // Auto-routed videos: use first as feature reference if no explicit videoUrl
      const effectiveVideoUrl = videoUrl || (videoUrls?.length ? videoUrls[0] : undefined);
      const effectiveVideoReferType = videoUrl ? videoReferType : (effectiveVideoUrl ? 'feature' : undefined);
      taskId = await createKlingTask({
        prompt: finalPrompt,
        images: filteredImages,
        mode: route.providerMode,
        duration: resolvedDuration,
        aspect_ratio: resolvedRatio,
        videoUrl: effectiveVideoUrl,
        videoReferType: effectiveVideoReferType,
        keepOriginalSound,
      });
      console.log(`✅ [create_video] Kling task created: ${taskId}`);
    } else {
      return {
        success: false,
        message: `No video provider adapter is registered for "${provider}". Add its API adapter and model capability before using this model.`,
      };
    }

    return {
      success: true,
      taskId,
      videoModel: provider,
      providerModel: route.providerModel,
      message: `Video rendering task created. Task ID: ${taskId}. Rendering time depends on the selected model. Use makaron_get_video_status to poll.`,
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
