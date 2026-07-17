'use client';

import { startTransition, useEffect, useState } from 'react';

/**
 * Keeps auth/runtime-dependent markup identical between SSR and the first
 * client render. Values that depend on browser storage or native runtime
 * detection may only affect the tree after hydration has committed.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    startTransition(() => setHydrated(true));
  }, []);

  return hydrated;
}
