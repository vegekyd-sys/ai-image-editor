const VIDEO_DECODE_PATTERNS = [
  /cannot decode/i,
  /could not be decoded/i,
  /failed to decode/i,
  /decoder.*(?:failed|unsupported)/i,
  /unsupported (?:video )?codec/i,
  /no video track found/i,
];

export type RemotionPreviewFailure = {
  error: string;
  code?: 'composition_video_decode';
};

/**
 * Classify decoder failures for observability without deciding how the Agent
 * must repair them. The runtime owns its fallback, but authoring remains open.
 */
export function remotionPreviewFailure(message: string, prefix: string): RemotionPreviewFailure {
  const error = `${prefix}: ${message}`;
  if (!VIDEO_DECODE_PATTERNS.some(pattern => pattern.test(message))) {
    return { error };
  }

  return {
    error,
    code: 'composition_video_decode',
  };
}
