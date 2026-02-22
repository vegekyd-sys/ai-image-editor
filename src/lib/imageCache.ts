const DB_NAME = 'makaron-images'
const STORE = 'images'
const TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

interface CacheEntry {
  key: string
  base64: string
  cachedAt: number
}

// In-memory layer: synchronous, survives client-side navigation within the same tab session
const memoryCache = new Map<string, string>()

// IDB layer: persistent across tab close/reopen
let dbPromise: Promise<IDBDatabase | null> | null = null

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { dbPromise = null; reject(req.error) }
    })
  }
  return dbPromise
}

async function writeToIDB(key: string, base64: string): Promise<void> {
  try {
    const db = await getDB()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const entry: CacheEntry = { key, base64, cachedAt: Date.now() }
      const req = tx.objectStore(STORE).put(entry)
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IDB failures are non-critical
  }
}

// Synchronous in-memory write + async IDB write (fire-and-forget)
export function cacheImage(key: string, base64: string): void {
  memoryCache.set(key, base64)
  void writeToIDB(key, base64)
}

export async function getCachedImages(keys: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (keys.length === 0) return result

  // Memory layer first (synchronous, no async needed)
  const idbKeys: string[] = []
  for (const key of keys) {
    const mem = memoryCache.get(key)
    if (mem) {
      result.set(key, mem)
    } else {
      idbKeys.push(key)
    }
  }

  if (idbKeys.length === 0) return result

  // IDB layer for cache misses (cross-session persistence)
  try {
    const db = await getDB()
    if (!db) return result
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const now = Date.now()
    await Promise.all(idbKeys.map(key => new Promise<void>((resolve) => {
      const req = store.get(key)
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined
        if (!entry || now - entry.cachedAt > TTL_MS) { resolve(); return }
        result.set(key, entry.base64)
        memoryCache.set(key, entry.base64)  // Warm memory cache from IDB
        resolve()
      }
      req.onerror = () => resolve()
    })))
  } catch {
    // IDB failures are non-critical
  }

  return result
}
