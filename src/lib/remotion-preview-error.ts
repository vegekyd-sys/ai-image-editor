const VIDEO_DECODE_PATTERNS = [
  /cannot decode/i,
  /could not be decoded/i,
  /failed to decode/i,
  /decoder.*(?:failed|unsupported)/i,
  /unsupported (?:video )?codec/i,
  /no video track found/i,
];

const INFRASTRUCTURE_PATTERNS = [
  /status code (?:400|401|403|404) is not ok/i,
  /snapshot not found/i,
  /could not get credentials from oidc context/i,
  /vercel sandbox.*(?:authorization|permission|unavailable)/i,
];

export type RemotionPreviewFailure = {
  error: string;
  code?: 'composition_video_decode' | 'remotion_preview_infrastructure';
  diagnostic?: string;
};

/**
 * Classify decoder failures for observability without deciding how the Agent
 * must repair them. The runtime owns its fallback, but authoring remains open.
 */
export function remotionPreviewFailure(message: string, prefix: string): RemotionPreviewFailure {
  const error = `${prefix}: ${message}`;
  if (INFRASTRUCTURE_PATTERNS.some(pattern => pattern.test(message))) {
    return {
      error: 'Preview service is temporarily unavailable. Preserve the current composition and generated assets; do not copy, replace, or regenerate media based on this preview failure.',
      code: 'remotion_preview_infrastructure',
      diagnostic: error,
    };
  }

  if (!VIDEO_DECODE_PATTERNS.some(pattern => pattern.test(message))) {
    return { error };
  }

  return {
    error,
    code: 'composition_video_decode',
  };
}
