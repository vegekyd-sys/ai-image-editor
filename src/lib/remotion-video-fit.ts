import React from 'react';

const FITS = new Set(['contain', 'cover', 'fill', 'none', 'scale-down']);

/** @remotion/media draws into a canvas and overrides CSS objectFit with its
 * component prop. Native Remotion video uses CSS instead. Keep both decoders
 * on the same authored fit, including legacy compositions that only use CSS. */
export function withVideoFit(
  Component: React.ElementType,
  usesObjectFitProp: boolean,
): React.ElementType {
  return React.forwardRef(function VideoWithAuthoredFit(
    props: Record<string, any>, ref: React.ForwardedRef<any>,
  ) {
    const { objectFit, style, ...rest } = props;
    // The explicit component prop owns the fit when both forms were supplied.
    const fit = FITS.has(objectFit) ? objectFit : FITS.has(style?.objectFit) ? style.objectFit : undefined;
    return React.createElement(Component, {
      ...rest,
      ...(ref ? { ref } : {}),
      ...(fit ? { style: { ...style, objectFit: fit } } : { style }),
      ...(usesObjectFitProp && fit ? { objectFit: fit } : {}),
    });
  });
}
