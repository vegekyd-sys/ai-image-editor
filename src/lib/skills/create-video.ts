import { filterAndRemapImages, parseTotalDuration } from '../kling';
import { getVideoModelCapability, normalizeVideoModelId, resolveClosestSupportedAspectRatio, resolveVideoGenerationRoute, resolveVideoImageWorkflow, resolveVideoOutputDuration, resolveVideoProviderAspectRatio, resolveVideoProviderModel, supportsNativeTextToVideo, validateVideoModelRequest, type VideoAspectRatioInput, type VideoGenerationOperation, type VideoImageWorkflow, type VideoReferenceMeta, type VideoResolutionInput } from '@/lib/video-model-capabilities';

const MAX_REFERENCE_VIDEO_PROBE_BYTES = 55 * 1024 * 1024;

export interface CreateVideoInput {
  script: string;
  images: string[];          // public URLs only (no base64)
  duration?: number;         // 3, 5, 7, 10, or 15 seconds. Omit for smart mode
  aspectRatio?: VideoAspectRatioInput;
  videoModel?: string;       // video provider/model id, e.g. 'kling' or 'seedance'
  videoResolution?: VideoResolutionInput;
  // Video reference / edit / extend
  videoUrl?: string;                    // Reference video URL (explicit from agent)
  videoReferType?: 'base' | 'feature';  // default: 'base'
  videoUrls?: string[];                 // Auto-detected video references from timeline
  audioUrls?: string[];                 // SeeDance reference audios (0-3)
  referenceVoiceIds?: string[];         // xAI preset voice ids (0-3)
  referenceVideoDuration?: number;       // Timeline video duration; output should match when editing video
  referenceVideoMetas?: VideoReferenceMeta[];
  keepOriginalSound?: boolean;          // default: false
  // Motion Control (Kling only)
  motionControl?: boolean;              // Use /v1/videos/motion-control endpoint
  characterOrientation?: 'image' | 'video';  // default: 'image'
  videoOperation?: VideoGenerationOperation; // Typed edit/extend for providers that expose it
  // Images are feature references unless a model explicitly opts into and the
  // caller explicitly requests a first-frame/image-to-video workflow.
  imageWorkflow?: VideoImageWorkflow;
  previousInteractionId?: string;            // Google Omni stateful extension lineage
  videoExtendDirection?: 'forward' | 'backward';
  generateAudio?: boolean;
  contentFilter?: boolean;
  outputFormat?: 'mp4' | 'mov';
  webSearch?: boolean;
  /** Authenticated owner used only for the private Grok subscription relay. */
  userId?: string;
  /** Called before a safe subscription-to-API fallback creates a paid task. */
  onBeforeGrokApiFallback?: () => Promise<void>;
}

export interface CreateVideoResult {
  success: boolean;
  taskId?: string;
  videoModel?: string;
  providerModel?: string;
  provider?: string;
  videoUrl?: string;
  status?: 'completed' | 'processing' | 'pending' | 'failed';
  message: string;
  retryable?: boolean;
  repairable?: boolean;
  terminal?: boolean;
  errorCode?: string;
  errorReason?: string;
  errorDetails?: Record<string, unknown>;
  suggestedAction?: string;
  userMessage?: { en: string; zh: string };
  invalidMediaUrls?: string[];
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

function resolveReferenceAspectRatio(
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

function findAudioMarkers(prompt: string): Set<number> {
  return new Set([
    ...Array.from(prompt.matchAll(/<<<audio_(\d+)>>>/gi), match => Number(match[1])),
    ...Array.from(prompt.matchAll(/@audio(\d+)/gi), match => Number(match[1])),
  ].filter(n => Number.isInteger(n) && n > 0));
}

export function prepareSeedance20References(options: {
  prompt: string;
  images: string[];
  videoUrls: string[];
}): { prompt: string; images: string[] } {
  const refs = [...new Set(
    Array.from(options.prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), match => Number(match[1]))
  )];
  const mediaTags = new Map<number, string>();
  const referencedImages: string[] = [];
  let videoIndex = 0;

  for (const ref of refs) {
    const image = options.images[ref - 1];
    if (image?.startsWith('http')) {
      referencedImages.push(image);
      mediaTags.set(ref, `@image${referencedImages.length}`);
    } else if (videoIndex < options.videoUrls.length) {
      videoIndex += 1;
      mediaTags.set(ref, `@video${videoIndex}`);
    }
  }

  let prompt = options.prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (marker, rawIndex) => {
    return mediaTags.get(Number(rawIndex)) || marker;
  });
  prompt = prompt
    .replace(/<<<video_(\d+)>>>/gi, (_marker, rawIndex) => `@video${Number(rawIndex)}`)
    .replace(/<<<audio_(\d+)>>>/gi, (_marker, rawIndex) => `@audio${Number(rawIndex)}`);

  if (videoIndex < options.videoUrls.length) {
    const remaining = options.videoUrls
      .slice(videoIndex)
      .map((_, index) => `@video${videoIndex + index + 1}`)
      .join(', ');
    prompt = `${prompt}\nUse ${remaining} as motion, camera, and visual-style references.`;
  }

  return { prompt, images: referencedImages };
}

function prepareSeedance25References(options: {
  prompt: string;
  images: string[];
  videoUrls: string[];
  audioUrls: string[];
  operation: VideoGenerationOperation;
  extendDirection?: 'forward' | 'backward';
}): { prompt: string; images: string[] } {
  const refs = [...new Set(
    Array.from(options.prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), match => Number(match[1]))
  )];
  const mediaTags = new Map<number, string>();
  const referencedImages: string[] = [];
  let videoIndex = 0;

  for (const ref of refs) {
    const image = options.images[ref - 1];
    if (image?.startsWith('http')) {
      referencedImages.push(image);
      mediaTags.set(ref, `@image${referencedImages.length}`);
    } else if (videoIndex < options.videoUrls.length) {
      videoIndex += 1;
      mediaTags.set(ref, `@video${videoIndex}`);
    }
  }

  let prompt = options.prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (marker, rawIndex) => {
    return mediaTags.get(Number(rawIndex)) || marker;
  });
  prompt = prompt.replace(/<<<audio_(\d+)>>>/gi, (_marker, rawIndex) => `@audio${Number(rawIndex)}`);

  if (options.operation === 'edit') {
    prompt = `Edit @video1: ${prompt}`;
  } else if (options.operation === 'extend') {
    prompt = `Extend @video1 ${options.extendDirection || 'forward'}: ${prompt}`;
  } else if (videoIndex < options.videoUrls.length) {
    const remaining = options.videoUrls
      .slice(videoIndex)
      .map((_, index) => `@video${videoIndex + index + 1}`)
      .join(', ');
    prompt = `${prompt}\nUse ${remaining} as motion, camera, and visual-style references.`;
  }

  return { prompt, images: referencedImages };
}

function prepareWan30References(options: {
  prompt: string;
  images: string[];
  videoUrls: string[];
}): { prompt: string; images: string[] } {
  const refs = [...new Set(
    Array.from(options.prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), match => Number(match[1]))
  )];
  const mediaTags = new Map<number, string>();
  const referencedImages: string[] = [];
  let videoIndex = 0;

  for (const ref of refs) {
    const image = options.images[ref - 1];
    if (image?.startsWith('http')) {
      referencedImages.push(image);
      mediaTags.set(ref, `Image ${referencedImages.length}`);
    } else if (videoIndex < options.videoUrls.length) {
      videoIndex += 1;
      mediaTags.set(ref, `Video ${videoIndex}`);
    }
  }

  let prompt = options.prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (marker, rawIndex) => {
    return mediaTags.get(Number(rawIndex)) || marker;
  });
  prompt = prompt.replace(/<<<audio_(\d+)>>>/gi, (_marker, rawIndex) => `Audio ${Number(rawIndex)}`);

  if (videoIndex < options.videoUrls.length) {
    const remaining = options.videoUrls
      .slice(videoIndex)
      .map((_, index) => `Video ${videoIndex + index + 1}`)
      .join(', ');
    prompt = `${prompt}\nUse ${remaining} as motion, camera, and visual-style references.`;
  }

  return { prompt, images: referencedImages };
}

export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const { script, images, duration, aspectRatio, videoModel, videoResolution, videoUrl, videoReferType, videoUrls, audioUrls, referenceVoiceIds, referenceVideoDuration, referenceVideoMetas, keepOriginalSound, motionControl, characterOrientation, videoOperation = 'generate', imageWorkflow, previousInteractionId, videoExtendDirection, generateAudio, contentFilter, outputFormat, webSearch } = input;
  const hasVideoReference = !!videoUrl || !!videoUrls?.length || !!previousInteractionId;
  const hasAudioReference = !!audioUrls?.length;
  const hasVoiceReference = !!referenceVoiceIds?.length;
  const provider = normalizeVideoModelId(videoModel);
  const isWan30 = provider === 'wan-3.0' || provider === 'wan-3.0-prime';
  const route = resolveVideoGenerationRoute({ model: provider, resolution: videoResolution });
  const capability = getVideoModelCapability(provider);
  const providerVideoUrls = [...(videoUrl ? [videoUrl] : []), ...(videoUrls || [])].filter(Boolean);
  const modelError = validateVideoModelRequest({
    model: provider,
    resolution: route.resolution,
    aspectRatio,
    outputDuration: provider === 'seedance-2.5' && videoOperation === 'edit' ? -1 : duration,
    referenceVideoDuration: previousInteractionId ? Math.min(referenceVideoDuration ?? 10, 10) : referenceVideoDuration,
    referenceVideoMetas,
    hasVideoReference,
    videoReferenceCount: previousInteractionId ? 1 : providerVideoUrls.length,
    audioReferenceCount: audioUrls?.length || 0,
    imageWorkflow,
    operation: videoOperation,
  });

  if (modelError) return { success: false, message: modelError };
  // Agent runtimes may serialize optional booleans as either true or false even
  // when the selected model does not own that option. Wan has no Makaron
  // content-filter toggle, and its MuleRouter request builder never forwards
  // this field, so both values are harmless no-ops. Seedance 2.5 remains the
  // only route where contentFilter changes provider behavior or billing.
  if ((videoOperation === 'edit' || videoOperation === 'extend') && !hasVideoReference) {
    return {
      success: false,
      message: `${capability.label} ${videoOperation} requires at least one video reference.`,
    };
  }
  if (provider === 'google-omni' && videoOperation === 'extend' && videoExtendDirection === 'backward') {
    return {
      success: false,
      message: 'Google Omni can only extend forward from the end of the source video.',
    };
  }
  if (provider === 'google-omni' && previousInteractionId && (referenceVideoDuration ?? 0) + (duration ?? 10) > 40) {
    return {
      success: false,
      message: 'Google Omni stateful extension supports a maximum cumulative duration of 40 seconds.',
    };
  }
  if (hasAudioReference && route.provider !== 'seedance' && route.provider !== 'mulerouter' && route.provider !== 'minimax' && route.provider !== 'fal-sync') {
    return {
      success: false,
      message: route.provider === 'google-omni'
        ? 'Google Omni generates native audio from the prompt, but uploaded reference audio is not enabled in the current API. Use Seedance for audio_refs, or describe the soundtrack in the prompt for Omni.'
        : 'Reference audio is only supported by Seedance, Wan 3.0, MiniMax H3, and Sync Lipsync v3.',
    };
  }
  if (hasVoiceReference && route.provider !== 'grok') {
    return {
      success: false,
      message: 'Preset reference voices are currently supported only by Grok Imagine Video 1.5.',
    };
  }
  if ((referenceVoiceIds?.length || 0) > 3) {
    return {
      success: false,
      message: 'Grok Imagine Video 1.5 supports at most 3 preset reference voices per request.',
    };
  }
  if ((audioUrls?.length || 0) > (capability.maxAudioReferences ?? 3)) {
    return {
      success: false,
      message: `${capability.label} supports at most ${capability.maxAudioReferences ?? 3} reference audio files per generation.`,
    };
  }
  const resolvedReferenceVideoMetas = await fillReferenceVideoMetas(providerVideoUrls, referenceVideoMetas);

  if (images.length === 0 && !hasVideoReference) {
    if (hasAudioReference && provider !== 'seedance-2.5' && !isWan30) {
      return {
        success: false,
        message: 'Reference audio cannot be used alone. Provide an image or video reference for the video generation.',
      };
    }
    if (!supportsNativeTextToVideo(provider)) {
      return {
        success: false,
        message: `${capability.label} requires an image or video reference. Native text-to-video is currently available through SeeDance, Wan 3.0, Grok Imagine Video 1.5, Gemini Omni, MiniMax H3, and MiniMax H3 Max.`,
      };
    }
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
    // Preserve the historical seven-image baseline while allowing providers
    // such as MiniMax H3 and Seedance 2.5 to expose larger documented limits.
    const initialFiltered = filterAndRemapImages(script, images, Math.max(7, capability.maxImageReferences ?? 7));
    let filteredImages = initialFiltered.filteredImages;
    let finalPrompt = initialFiltered.finalPrompt;
    if (provider === 'seedance-2.5') {
      const prepared = prepareSeedance25References({
        prompt: script,
        images,
        videoUrls: providerVideoUrls,
        audioUrls: audioUrls || [],
        operation: videoOperation,
        extendDirection: videoExtendDirection,
      });
      filteredImages = prepared.images;
      finalPrompt = prepared.prompt;
    } else if (route.provider === 'seedance') {
      const prepared = prepareSeedance20References({
        prompt: script,
        images,
        videoUrls: providerVideoUrls,
      });
      filteredImages = prepared.images;
      finalPrompt = prepared.prompt;
    } else if (isWan30) {
      const prepared = prepareWan30References({
        prompt: script,
        images,
        videoUrls: providerVideoUrls,
      });
      filteredImages = prepared.images;
      finalPrompt = prepared.prompt;
    }

    if (hasAudioReference) {
      const audioMarkers = findAudioMarkers(script);
      const missing = (audioUrls || [])
        .map((_, index) => index + 1)
        .filter(index => !audioMarkers.has(index));
      if (missing.length > 0) {
        return {
          success: false,
          message: `Reference audio was passed but not referenced in story_prompt. Add ${missing.map(index => `<<<audio_${index}>>>`).join(', ')} to the story_prompt near the soundtrack/rhythm instruction, and keep audio_refs set.`,
        };
      }
    }

    const usableImageCount = images.filter(image => image?.startsWith('http')).length;
    if (filteredImages.length === 0 && usableImageCount > 0 && !hasVideoReference) {
      return {
        success: false,
        message: `No images referenced in the script but ${usableImageCount} images were provided. Use <<<media_1>>> etc. to reference them in your prompt.`,
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
      operation: videoOperation,
    }) ?? parseTotalDuration(finalPrompt);

    const filteredModelError = validateVideoModelRequest({
      model: provider,
      resolution: route.resolution,
      aspectRatio,
      outputDuration: provider === 'seedance-2.5' && videoOperation === 'edit' ? -1 : resolvedDuration,
      referenceVideoDuration: previousInteractionId ? Math.min(referenceVideoDuration ?? 10, 10) : referenceVideoDuration,
      referenceVideoMetas: resolvedReferenceVideoMetas,
      hasVideoReference,
      imageReferenceCount: filteredImages.length,
      videoReferenceCount: providerVideoUrls.length,
      audioReferenceCount: audioUrls?.length || 0,
      voiceReferenceCount: referenceVoiceIds?.length || 0,
      imageWorkflow,
      operation: videoOperation,
    });
    if (filteredModelError) return { success: false, message: filteredModelError };

    const resolvedImageWorkflow = resolveVideoImageWorkflow({
      model: provider,
      imageReferenceCount: filteredImages.length,
      requestedWorkflow: imageWorkflow,
    });

    const loggedVideoRefType = videoUrl ? (videoReferType ?? 'base') : (videoUrls?.length ? 'feature' : undefined);
    let providerAspectRatio = resolveReferenceAspectRatio(provider, aspectRatio, providerVideoUrls.length > 0, resolvedReferenceVideoMetas);
    if (provider === 'seedance-2.5' && (videoOperation !== 'generate' || resolvedDuration === -1)) {
      providerAspectRatio = 'adaptive';
    }
    if (route.provider === 'fal-sync') providerAspectRatio = undefined;
    console.log(`\n🎬 [create_video] provider=${provider}, resolution=${route.resolution}, ${filteredImages.length}/${images.length} images${resolvedImageWorkflow ? `, imageWorkflow=${resolvedImageWorkflow}` : ''}, duration=${resolvedDuration ?? 'smart'}, aspectRatio=${providerAspectRatio ?? 'auto'}${hasVideoReference ? `, video=${loggedVideoRefType}` : ''}${hasAudioReference ? `, audio=${audioUrls?.length}` : ''}`);
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

    if (route.provider === 'fal-sync') {
      if (filteredImages.length > 0) {
        return { success: false, message: 'Sync Lipsync v3 accepts one source video and one replacement audio file, not image references.' };
      }
      if (providerVideoUrls.length !== 1 || (audioUrls?.length || 0) !== 1) {
        return {
          success: false,
          message: 'Sync Lipsync v3 requires exactly one source video and exactly one reference audio file.',
        };
      }
      const { createSyncLipsyncTask } = await import('../sync-lipsync');
      taskId = await createSyncLipsyncTask({
        videoUrl: providerVideoUrls[0],
        audioUrl: audioUrls![0],
      });
      console.log(`✅ [create_video] Sync Lipsync v3 task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel: route.providerModel,
        message: `Lip-sync task created. Task ID: ${taskId}. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'seedance') {
      const { createEvolinkTask } = await import('../evolink');
      const providerModel = resolveVideoProviderModel({
        model: provider,
        resolution: route.resolution,
        aspectRatio,
        imageReferenceCount: filteredImages.length,
        hasVideoReference: providerVideoUrls.length > 0,
        hasAudioReference,
        operation: videoOperation,
      });
      const providerDuration = provider === 'seedance-2.5' && videoOperation === 'edit'
        ? -1
        : resolvedDuration != null ? resolvedDuration : undefined;
      const providerPrompt = finalPrompt;
      taskId = await createEvolinkTask({
        prompt: providerPrompt,
        images: filteredImages,
        duration: providerDuration,
        aspectRatio: providerAspectRatio,
        quality: route.resolution,
        model: providerModel,
        videoUrls: providerVideoUrls.length ? providerVideoUrls : undefined,
        audioUrls: audioUrls?.length ? audioUrls : undefined,
        generateAudio,
        contentFilter,
        outputFormat,
        webSearch,
      });
      console.log(`✅ [create_video] ${capability.label} (Evolink) task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel,
        message: `Video rendering task created. Task ID: ${taskId}. Rendering time depends on the selected model. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'mulerouter') {
      const { createMuleRouterVideoTask } = await import('../mulerouter-video');
      const usesProResolution = route.resolution === '2k' || route.resolution === '4k';
      taskId = await createMuleRouterVideoTask({
        model: provider === 'wan-3.0-prime'
          ? usesProResolution ? 'prime-pro' : 'prime'
          : usesProResolution ? 'pro' : 'standard',
        prompt: finalPrompt,
        images: filteredImages,
        videoUrls: providerVideoUrls.length ? providerVideoUrls : undefined,
        audioUrls: audioUrls?.length ? audioUrls : undefined,
        duration: resolvedDuration != null ? resolvedDuration : -1,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '480p' | '720p' | '1080p' | '2k' | '4k',
        generateAudio,
      });
      console.log(`✅ [create_video] ${capability.label} (MuleRouter) task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel: route.providerModel,
        message: `MuleRouter video task created. Task ID: ${taskId}. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'minimax') {
      const { createMinimaxVideoTask } = await import('../minimax-video');
      taskId = await createMinimaxVideoTask({
        prompt: finalPrompt,
        images: filteredImages,
        videoUrls: providerVideoUrls.length ? providerVideoUrls : undefined,
        audioUrls: audioUrls?.length ? audioUrls : undefined,
        duration: resolvedDuration ?? 5,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '768p' | '2k',
      });
      console.log(`✅ [create_video] MiniMax H3 task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel: route.providerModel,
        message: `MiniMax H3 video task created. Task ID: ${taskId}. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'fal-h3-max') {
      if (providerVideoUrls.length > 0 || (audioUrls?.length || 0) > 0) {
        return {
          success: false,
          message: 'MiniMax H3 Max Turbo currently supports text-to-video or one-image-to-video only. Reference video and audio inputs are not available yet.',
        };
      }
      const { createFalH3MaxVideoTask } = await import('../fal-h3-max-video');
      const providerModel = resolveVideoProviderModel({
        model: provider,
        resolution: route.resolution,
        aspectRatio,
        imageReferenceCount: filteredImages.length,
        operation: videoOperation,
      });
      taskId = await createFalH3MaxVideoTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration ?? 5,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '480p' | '768p',
      });
      console.log(`✅ [create_video] MiniMax H3 Max Turbo task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel,
        message: `MiniMax H3 Max Turbo ${filteredImages.length ? 'image-to-video' : 'text-to-video'} task created. Task ID: ${taskId}. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'grok') {
      const { createXaiVideoTask } = await import('../xai-video');
      const xaiSubmission = await createXaiVideoTask({
        prompt: finalPrompt,
        images: filteredImages,
        videoUrl: providerVideoUrls[0],
        operation: videoOperation,
        duration: resolvedDuration != null ? resolvedDuration : undefined,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '480p' | '720p' | '1080p',
        generateAudio,
        referenceVoiceIds,
      }, {
        userId: input.userId,
        onBeforeApiFallback: input.onBeforeGrokApiFallback,
      });
      taskId = xaiSubmission.taskId;
      console.log(`✅ [create_video] Grok Video task created: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel: xaiSubmission.providerModel,
        provider: xaiSubmission.provider,
        message: `Grok ${xaiSubmission.mode} task created through ${xaiSubmission.provider === 'grok-subscription' ? 'the personal Grok plan' : 'the xAI API'}. Task ID: ${taskId}. Use makaron_get_video_status to poll.`,
      };
    } else if (route.provider === 'google-omni') {
      const { createGoogleOmniVideoTask } = await import('../google-omni-video');
      if ((videoUrls?.length || 0) > 1 || (videoUrl && (videoUrls?.length || 0) > 0)) {
        return {
          success: false,
          message: 'Google Omni supports one reference video per request in Makaron. Split multi-video workflows into separate tasks.',
        };
      }
      const omniResult = await createGoogleOmniVideoTask({
        prompt: finalPrompt,
        images: filteredImages,
        duration: resolvedDuration != null ? resolvedDuration : undefined,
        aspectRatio: providerAspectRatio,
        resolution: route.resolution as '360p' | '720p' | '1080p' | '4k',
        operation: videoOperation,
        previousInteractionId,
        videoUrl,
        videoUrls,
      });
      taskId = omniResult.taskId;
      console.log(`✅ [create_video] Google Omni video completed: ${taskId}`);
      return {
        success: true,
        taskId,
        videoModel: provider,
        providerModel: route.providerModel,
        videoUrl: omniResult.videoUrl,
        status: omniResult.status,
        message: `Google Omni video generated. Task ID: ${taskId}. Use makaron_get_video_status to persist and retrieve the final URL.`,
      };
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
    const { EvolinkInputError } = await import('../evolink');
    if (e instanceof EvolinkInputError) {
      console.warn('[create_video input rejected]', e.message);
      return {
        success: false,
        message: e.message,
        retryable: false,
        repairable: e.repairable,
        terminal: e.terminal,
        errorCode: e.code,
        errorReason: e.reason,
        errorDetails: e.details,
        suggestedAction: e.suggestedAction,
        userMessage: e.userMessage,
        invalidMediaUrls: e.invalidMediaUrls,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create_video error]', msg);
    return {
      success: false,
      message: `Video creation error: ${msg}`,
    };
  }
}
