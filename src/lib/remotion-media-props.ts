import React from 'react';

/** Normalize legacy Remotion trims before selecting a decoder. Html5Video
 * accepts startFrom/endAt, while @remotion/media silently ignores them. */
export function normalizeMediaTrimProps(props: Record<string, any>): Record<string, any> {
  const { startFrom, endAt, ...rest } = props;
  return {
    ...rest,
    ...(props.trimBefore !== undefined || startFrom !== undefined
      ? { trimBefore: props.trimBefore ?? startFrom } : {}),
    ...(props.trimAfter !== undefined || endAt !== undefined
      ? { trimAfter: props.trimAfter ?? endAt } : {}),
  };
}

export function withMediaTrim(Component: React.ElementType): React.ComponentType<any> {
  return React.forwardRef(function MediaWithNormalizedTrim(props: Record<string, any>, ref: React.ForwardedRef<any>) {
    return React.createElement(Component, { ...normalizeMediaTrimProps(props), ...(ref ? { ref } : {}) });
  });
}

/** Native video cannot apply canvas effects, pitch shifts, alternate sound
 * tracks, or custom request headers. Use the media decoder for these features
 * in Player too, rather than silently dropping them until export. */
export function requiresMediaDecoder(props: Record<string, any>): boolean {
  return (props.effects != null && (!Array.isArray(props.effects) || props.effects.length > 0))
    || (props.toneFrequency != null && props.toneFrequency !== 1)
    || (props.audioStreamIndex != null && props.audioStreamIndex !== 0)
    || props.requestInit != null;
}
