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

function getStorage(type: 'session' | 'local'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return type === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function parseCacheEntry<T>(raw: string | null): CacheEntry<T> | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.cachedAt !== 'number') return null;
    return entry;
  } catch {
    return null;
  }
}

function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.cachedAt <= ttlMs;
}

export function readNativeJSONCache<T>(path: string, ttlMs = DEFAULT_TTL_MS): T | null {
  const session = getStorage('session');
  const local = getStorage('local');
  if (!session && !local) return null;
  const key = keyFor(path);

  try {
    const sessionEntry = parseCacheEntry<T>(session?.getItem(key) ?? null);
    if (sessionEntry) {
      if (isFresh(sessionEntry, ttlMs)) return sessionEntry.data;
      session?.removeItem(key);
    }

    const localEntry = parseCacheEntry<T>(local?.getItem(key) ?? null);
    if (localEntry) {
      if (isFresh(localEntry, ttlMs)) {
        session?.setItem(key, JSON.stringify(localEntry));
        return localEntry.data;
      }
      local?.removeItem(key);
    }
  } catch {
    return null;
  }
  return null;
}

export function writeNativeJSONCache<T>(path: string, data: T): void {
  const session = getStorage('session');
  const local = getStorage('local');
  if (!session && !local) return;
  try {
    const serialized = JSON.stringify({ data, cachedAt: Date.now() });
    session?.setItem(keyFor(path), serialized);
    local?.setItem(keyFor(path), serialized);
  } catch {
    // Native cache is best-effort; storage pressure should never block UI.
  }
}

export function removeNativeJSONCache(path: string): void {
  const session = getStorage('session');
  const local = getStorage('local');
  if (!session && !local) return;
  try {
    session?.removeItem(keyFor(path));
    local?.removeItem(keyFor(path));
  } catch {
    // Cache removal is best-effort.
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
