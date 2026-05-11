import { useCallback, useSyncExternalStore } from 'react';

function getVisualViewportInset(): number {
  if (typeof window === 'undefined') return 0;

  const visualViewport = window.visualViewport;
  if (!visualViewport) return 0;

  return Math.round(Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop));
}

/**
 * Returns the covered bottom inset reported by VisualViewport while active.
 * Useful for mobile keyboard-aware floating panels without leaking viewport
 * event wiring into feature components.
 */
export function useVisualViewportInset(active: boolean): number {
  const getSnapshot = useCallback(() => (active ? getVisualViewportInset() : 0), [active]);
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!active || typeof window === 'undefined') return () => {};

    const visualViewport = window.visualViewport;
    if (!visualViewport) return () => {};

    visualViewport.addEventListener('resize', onStoreChange);
    visualViewport.addEventListener('scroll', onStoreChange);

    return () => {
      visualViewport.removeEventListener('resize', onStoreChange);
      visualViewport.removeEventListener('scroll', onStoreChange);
    };
  }, [active]);

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
