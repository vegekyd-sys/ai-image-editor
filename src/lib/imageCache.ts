const DB_NAME = 'makaron-images'
const STORE = 'images'
const PROJECT_STORE = 'project-data'
const TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

interface CacheEntry {
  key: string
  base64: string
  cachedAt: number
}

interface ProjectCacheEntry {
  projectId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshots: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]
  title: string
  cachedAt: number
}

// In-memory layer: synchronous, survives client-side navigation within the same tab session
const memoryCache = new Map<string, string>()
const projectMemCache = new Map<string, ProjectCacheEntry>()

// IDB layer: persistent across tab close/reopen
let dbPromise: Promise<IDBDatabase | null> | null = null

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(PROJECT_STORE)) {
          db.createObjectStore(PROJECT_STORE, { keyPath: 'projectId' })
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

// Synchronous memory-only lookup (use in useState initializer to avoid spinner flash)
export function getCachedProjectDataSync(
  projectId: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { snapshots: any[], messages: any[], title: string } | null {
  if (typeof window === 'undefined') return null
  const mem = projectMemCache.get(projectId)
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    return { snapshots: mem.snapshots, messages: mem.messages, title: mem.title }
  }
  return null
}

// Project metadata cache (snapshots + messages + title, no base64 images)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cacheProjectData(projectId: string, snapshots: any[], messages: any[], title: string): void {
  const entry: ProjectCacheEntry = { projectId, snapshots, messages, title, cachedAt: Date.now() }
  projectMemCache.set(projectId, entry)
  void writeProjectToIDB(entry)
}

export async function getCachedProjectData(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ snapshots: any[], messages: any[], title: string } | null> {
  const mem = projectMemCache.get(projectId)
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    return { snapshots: mem.snapshots, messages: mem.messages, title: mem.title }
  }

  try {
    const db = await getDB()
    if (!db) return null
    const entry = await new Promise<ProjectCacheEntry | null>((resolve) => {
      const tx = db.transaction(PROJECT_STORE, 'readonly')
      const req = tx.objectStore(PROJECT_STORE).get(projectId)
      req.onsuccess = () => resolve(req.result as ProjectCacheEntry | null ?? null)
      req.onerror = () => resolve(null)
    })
    if (!entry || Date.now() - entry.cachedAt > TTL_MS) return null
    projectMemCache.set(projectId, entry)
    return { snapshots: entry.snapshots, messages: entry.messages, title: entry.title }
  } catch {
    return null
  }
}

async function writeProjectToIDB(entry: ProjectCacheEntry): Promise<void> {
  try {
    const db = await getDB()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, 'readwrite')
      tx.objectStore(PROJECT_STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IDB failures are non-critical
  }
}
