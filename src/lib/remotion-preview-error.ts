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
  retryable?: false;
  terminal?: true;
};

/**
 * Convert deterministic video-decoder failures into a terminal tool result.
 * Composition code cannot repair these failures by swapping Video aliases.
 */
export function remotionPreviewFailure(message: string, prefix: string): RemotionPreviewFailure {
  const error = `${prefix}: ${message}`;
  if (!VIDEO_DECODE_PATTERNS.some(pattern => pattern.test(message))) {
    return { error };
  }

  return {
    error: `${error}\nThis is a preview-runtime media decode failure, not a composition-code failure. Do not rewrite <Video>/<OffthreadVideo>, do not create a compatibility copy, and do not retry the same preview in this turn. Keep the existing composition and report the exact runtime error.`,
    code: 'composition_video_decode',
    retryable: false,
    terminal: true,
  };
}
