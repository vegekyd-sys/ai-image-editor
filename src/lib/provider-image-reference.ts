const SEEDANCE_MIN_IMAGE_SIDE = 300;
const SEEDANCE_MAX_IMAGE_SIDE = 6000;
const SEEDANCE_MIN_IMAGE_ASPECT = 0.4;
const SEEDANCE_MAX_IMAGE_ASPECT = 2.5;
const SEEDANCE_MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const SEEDANCE_MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;

export interface ProviderImageMeta {
  width: number;
  height: number;
  fileSizeBytes: number;
  format?: string;
}

export interface ProviderImageValidationFailure {
  code:
    | 'seedance_reference_image_too_small'
    | 'seedance_reference_image_too_large'
    | 'seedance_reference_image_aspect_invalid'
    | 'seedance_reference_image_format_invalid'
    | 'seedance_reference_image_unreadable';
  reason: 'too_small' | 'too_large' | 'invalid_aspect_ratio' | 'unsupported_format' | 'unreadable';
  message: string;
  retryable: false;
  repairable: true;
  terminal: false;
  suggestedAction: string;
  invalidMediaUrls: string[];
  details: {
    imageIndex: number;
    actual?: ProviderImageMeta & { aspectRatio: number };
    limits: {
      minSide: number;
      maxSide: number;
      minAspectRatio: number;
      maxAspectRatio: number;
      maxBytesPerImage: number;
      maxTotalBytes: number;
    };
  };
  userMessage: {
    en: string;
    zh: string;
  };
}

async function readResponseWithLimit(response: Response, limitBytes: number): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > limitBytes) {
    throw new Error(`image_too_large:${declaredSize}`);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limitBytes) throw new Error(`image_too_large:${buffer.length}`);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > limitBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`image_too_large:${total}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

async function probeImage(url: string): Promise<ProviderImageMeta | null> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    console.warn('[seedance-image-preflight] could not fetch reference image; provider will validate it:', error);
    return null;
  }
  if (!response.ok) {
    console.warn(`[seedance-image-preflight] reference image returned ${response.status}; provider will validate it`);
    return null;
  }

  const buffer = await readResponseWithLimit(response, SEEDANCE_MAX_IMAGE_BYTES);
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('image_dimensions_unavailable');
  }
  return {
    width: metadata.width,
    height: metadata.height,
    fileSizeBytes: buffer.length,
    format: metadata.format,
  };
}

function invalidImageFailure(input: {
  index: number;
  url: string;
  reason: ProviderImageValidationFailure['reason'];
  explanation: string;
  meta?: ProviderImageMeta;
}): ProviderImageValidationFailure {
  const { index, url, reason, explanation, meta } = input;
  const size = meta ? `${meta.width}x${meta.height}px` : 'an unsupported or unreadable image';
  const code: ProviderImageValidationFailure['code'] = reason === 'too_small'
    ? 'seedance_reference_image_too_small'
    : reason === 'too_large'
      ? 'seedance_reference_image_too_large'
      : reason === 'invalid_aspect_ratio'
        ? 'seedance_reference_image_aspect_invalid'
        : reason === 'unsupported_format'
          ? 'seedance_reference_image_format_invalid'
          : 'seedance_reference_image_unreadable';
  const suggestedAction = reason === 'too_small'
    ? 'Use the original/full-resolution image, or resize/pad it so both sides are at least 300px (512px or larger recommended), then submit again with the new URL.'
    : reason === 'too_large'
      ? 'Resize/compress the image so each side is at most 6000px and the file is at most 30MB, then submit again with the new URL.'
      : reason === 'invalid_aspect_ratio'
        ? 'Pad or crop the image to an aspect ratio between 0.4 and 2.5, then submit again with the new URL.'
        : reason === 'unsupported_format'
          ? 'Convert the image to JPEG, PNG, or WebP, then submit again with the new URL.'
          : 'Replace the image with a readable JPEG, PNG, or WebP file, then submit again with the new URL.';
  const zhAction = reason === 'too_small'
    ? '换用原始/高清图片，或先放大、补边到宽高都至少 300px（建议 512px 以上）'
    : reason === 'too_large'
      ? '缩小或压缩图片，使宽高都不超过 6000px、文件不超过 30MB'
      : reason === 'invalid_aspect_ratio'
        ? '通过补边或裁切，把宽高比调整到 0.4–2.5'
        : reason === 'unsupported_format'
          ? '把图片转换成 JPEG、PNG 或 WebP'
          : '换成可正常读取的 JPEG、PNG 或 WebP 图片';
  return {
    code,
    reason,
    retryable: false,
    repairable: true,
    terminal: false,
    suggestedAction,
    invalidMediaUrls: [url],
    details: {
      imageIndex: index,
      ...(meta ? { actual: { ...meta, aspectRatio: meta.width / meta.height } } : {}),
      limits: {
        minSide: SEEDANCE_MIN_IMAGE_SIDE,
        maxSide: SEEDANCE_MAX_IMAGE_SIDE,
        minAspectRatio: SEEDANCE_MIN_IMAGE_ASPECT,
        maxAspectRatio: SEEDANCE_MAX_IMAGE_ASPECT,
        maxBytesPerImage: SEEDANCE_MAX_IMAGE_BYTES,
        maxTotalBytes: SEEDANCE_MAX_TOTAL_IMAGE_BYTES,
      },
    },
    message: `Seedance reference image ${index} is ${size}: ${explanation}. EvoLink requires JPEG/PNG/WebP, width and height 300-6000px, aspect ratio 0.4-2.5, and at most 30MB per image. The same image URL is not retryable. ${suggestedAction}`,
    userMessage: {
      en: `The video was not submitted. Reference image ${index} is ${reason.replaceAll('_', ' ')} (${size}). The same image URL will not work. ${suggestedAction}`,
      zh: `视频没有提交：第 ${index} 张参考图${reason === 'too_small' ? '过小' : reason === 'too_large' ? '过大' : reason === 'invalid_aspect_ratio' ? '宽高比不符合要求' : reason === 'unsupported_format' ? '格式不支持' : '无法读取'}（${size}）。Agent 可以${zhAction}后，用新的图片 URL 再提交；不能原样重试。`,
    },
  };
}

/**
 * EvoLink validates Seedance image dimensions after it downloads the URLs.
 * Probe first so deterministic input failures never become paid/retried tasks.
 * A transient fetch failure is left to the provider because its network path
 * may still be able to access the public URL.
 */
export async function validateSeedanceImageReferences(
  urls: string[],
): Promise<ProviderImageValidationFailure | null> {
  let totalBytes = 0;
  for (let i = 0; i < urls.length; i++) {
    let meta: ProviderImageMeta | null;
    try {
      meta = await probeImage(urls[i]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith('image_too_large:')) {
        return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'too_large', explanation: 'the file is larger than 30MB' });
      }
      return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'unreadable', explanation: 'the image could not be decoded as JPEG, PNG, or WebP' });
    }
    if (!meta) continue;

    totalBytes += meta.fileSizeBytes;
    const aspect = meta.width / meta.height;
    const supportedFormat = meta.format === 'jpeg' || meta.format === 'png' || meta.format === 'webp';
    if (!supportedFormat) {
      return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'unsupported_format', explanation: `format ${meta.format || 'unknown'} is not supported`, meta });
    }
    if (
      meta.width < SEEDANCE_MIN_IMAGE_SIDE
      || meta.height < SEEDANCE_MIN_IMAGE_SIDE
    ) {
      return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'too_small', explanation: 'one or both sides are below 300px', meta });
    }
    if (
      meta.width > SEEDANCE_MAX_IMAGE_SIDE
      || meta.height > SEEDANCE_MAX_IMAGE_SIDE
    ) {
      return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'too_large', explanation: 'one or both sides exceed 6000px', meta });
    }
    if (aspect < SEEDANCE_MIN_IMAGE_ASPECT || aspect > SEEDANCE_MAX_IMAGE_ASPECT) {
      return invalidImageFailure({ index: i + 1, url: urls[i], reason: 'invalid_aspect_ratio', explanation: `aspect ratio ${aspect.toFixed(2)} is outside 0.4-2.5`, meta });
    }
  }

  if (totalBytes > SEEDANCE_MAX_TOTAL_IMAGE_BYTES) {
    return invalidImageFailure({ index: 1, url: urls[0], reason: 'too_large', explanation: 'all reference images total more than 64MB' });
  }
  return null;
}
