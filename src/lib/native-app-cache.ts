'use client';

const PREFIX = 'makaron:native-cache:';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

function keyFor(path: string): string {
  return `${PREFIX}${path}`;
}

export function readNativeJSONCache<T>(path: string, ttlMs = DEFAULT_TTL_MS): T | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(keyFor(path));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || Date.now() - entry.cachedAt > ttlMs) {
      sessionStorage.removeItem(keyFor(path));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function writeNativeJSONCache<T>(path: string, data: T): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(keyFor(path), JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // Native cache is best-effort; storage pressure should never block UI.
  }
}

export async function warmNativeJSONCache(path: string): Promise<void> {
  try {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) return;
    writeNativeJSONCache(path, await res.json());
  } catch {
    // Network warmup is opportunistic.
  }
}
