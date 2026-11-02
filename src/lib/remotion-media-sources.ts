import React from 'react';

export function useMediaSources(value: unknown): Record<string, string> | undefined {
  // Remotion getInputProps() deserializes objects again on frame updates.
  // Component types must depend on content, not that changing object identity.
  const key = typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : '';
  return React.useMemo(() => {
    if (!key) return undefined;
    try {
      const parsed: unknown = JSON.parse(key);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    } catch {return undefined;}
  }, [key]);
}

/** Transport overrides are separate from authored code, props and font input. */
export function withMediaSource(Component: React.ComponentType<any>, sources?: Record<string, string>): React.ComponentType<any> {
  if (!sources || Object.keys(sources).length === 0) return Component;
  return React.forwardRef(function MediaWithSource(props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) {
    const src = typeof props.src === 'string' && Object.hasOwn(sources, props.src)
      ? sources[props.src] : props.src;
    return React.createElement(Component, {...props, src, ...(ref ? {ref} : {})});
  });
}
