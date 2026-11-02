import React from 'react';

/** Transport overrides are separate from authored code, props and font input. */
export function withMediaSource(Component: React.ElementType, sources?: Record<string, string>): React.ElementType {
  if (!sources || Object.keys(sources).length === 0) return Component;
  return React.forwardRef(function MediaWithSource(props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) {
    const src = typeof props.src === 'string' && Object.hasOwn(sources, props.src)
      ? sources[props.src] : props.src;
    return React.createElement(Component, {...props, src, ...(ref ? {ref} : {})});
  });
}
