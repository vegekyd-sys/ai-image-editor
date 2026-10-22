import React from 'react';
import { normalizeMediaTrimProps, requiresMediaDecoder } from './remotion-media-props';

const VIDEO_IDENTITY = Symbol.for('makaron.remotion.video');
export function isMakaronVideoComponent(component: unknown): boolean {
  return Boolean(component && (typeof component === 'object' || typeof component === 'function')
    && (component as Record<symbol, unknown>)[VIDEO_IDENTITY]);
}

const FITS = new Set(['contain', 'cover', 'fill', 'none', 'scale-down']);

/** @remotion/media draws into a canvas and overrides CSS objectFit with its
 * component prop. Native Remotion video uses CSS instead. Keep both decoders
 * on the same authored fit, including legacy compositions that only use CSS. */
export function withVideoFit(
  Component: React.ElementType,
  usesObjectFitProp: boolean,
  mediaComponent?: React.ElementType,
): React.ComponentType<any> {
  const Wrapped = React.forwardRef(function VideoWithAuthoredFit(
    props: Record<string, any>, ref: React.ForwardedRef<any>,
  ) {
    const { objectFit, style, ...rest } = normalizeMediaTrimProps(props);
    const useMedia = usesObjectFitProp || Boolean(mediaComponent && requiresMediaDecoder(props));
    const Decoder = useMedia && mediaComponent ? mediaComponent : Component;
    // The explicit component prop owns the fit when both forms were supplied.
    const fit = FITS.has(objectFit) ? objectFit : FITS.has(style?.objectFit) ? style.objectFit : undefined;
    return React.createElement(Decoder, {
      ...rest,
      ...(ref ? { ref } : {}),
      ...(fit ? { style: { ...style, objectFit: fit } } : { style }),
      ...(useMedia && fit ? { objectFit: fit } : {}),
    });
  });
  Object.defineProperty(Wrapped, VIDEO_IDENTITY, { value: true });
  return Wrapped;
}
