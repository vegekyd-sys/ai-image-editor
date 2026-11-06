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
