const DB_NAME = 'makaron-images'
const STORE = 'images'
const PROJECT_STORE = 'project-data'
const PROJECTS_LIST_STORE = 'projects-list'
const PROJECTS_LIST_SESSION_KEY = 'makaron:last-projects-list'
const PROJECTS_LIST_LOCAL_KEY = 'makaron:last-projects-list:persistent'
const CREATE_DRAFT_STORE = 'create-drafts'
const ACTIVE_CREATE_DRAFT_KEY = 'active'
const TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

export const PROJECTS_LIST_CACHE_UPDATED_EVENT = 'makaron-projects-list-cache-updated'

interface CacheEntry {
  key: string
  base64: string
  cachedAt: number
}

interface ProjectCacheEntry {
  projectId: string
  snapshots: any[]
  messages: any[]
  title: string
  cachedAt: number
}

interface ProjectsListCacheEntry {
  userId: string
  projects: any[]
  cachedAt: number
}

export interface CreateDraftEntry {
  key: string
  images: string[]
  metadata?: unknown
  prompt?: string
  selectedSkill?: string
  homeSkillId?: string
  returnPath?: string
  cachedAt: number
}

// In-memory layer: synchronous, survives client-side navigation within the same tab session
const memoryCache = new Map<string, string>()
const projectMemCache = new Map<string, ProjectCacheEntry>()
let projectsListMemCache: ProjectsListCacheEntry | null = null
let createDraftMemCache: CreateDraftEntry | null = null

// IDB layer: persistent across tab close/reopen
let dbPromise: Promise<IDBDatabase | null> | null = null

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 5)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(PROJECT_STORE)) {
          db.createObjectStore(PROJECT_STORE, { keyPath: 'projectId' })
        }
        if (!db.objectStoreNames.contains(PROJECTS_LIST_STORE)) {
          db.createObjectStore(PROJECTS_LIST_STORE, { keyPath: 'userId' })
        }
        if (!db.objectStoreNames.contains(CREATE_DRAFT_STORE)) {
          db.createObjectStore(CREATE_DRAFT_STORE, { keyPath: 'key' })
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
): { snapshots: any[], messages: any[], title: string } | null {
  if (typeof window === 'undefined') return null
  const mem = projectMemCache.get(projectId)
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    return { snapshots: mem.snapshots, messages: mem.messages, title: mem.title }
  }
  return null
}

// Project metadata cache (snapshots + messages + title, no base64 images)
export function cacheProjectData(projectId: string, snapshots: any[], messages: any[], title: string): void {
  const entry: ProjectCacheEntry = { projectId, snapshots, messages, title, cachedAt: Date.now() }
  projectMemCache.set(projectId, entry)
  void writeProjectToIDB(entry)
}

export async function getCachedProjectData(
  projectId: string,
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

/** Update tips for a snapshot in both memory cache and IDB. */
export function updateCachedTips(projectId: string, snapshotId: string, tips: any[]): void {
  const mem = projectMemCache.get(projectId)
  if (!mem) return
  const snap = (mem.snapshots as any[]).find((s: any) => s.id === snapshotId)
  if (snap) {
    snap.tips = tips
    mem.cachedAt = Date.now()
    void writeProjectToIDB(mem)
  }
}

// ── Projects List Cache (for /projects page) ──

export function cacheProjectsList(userId: string, projects: any[]): void {
  const entry: ProjectsListCacheEntry = { userId, projects, cachedAt: Date.now() }
  projectsListMemCache = entry
  try {
    const serialized = JSON.stringify(entry)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(PROJECTS_LIST_SESSION_KEY, serialized)
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECTS_LIST_LOCAL_KEY, serialized)
    }
  } catch {
    // Web storage failures are non-critical
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROJECTS_LIST_CACHE_UPDATED_EVENT, {
      detail: { userId, count: projects.length },
    }))
  }
  void writeProjectsListToIDB(entry)
}

export function getCachedProjectsListSync(userId: string): any[] | null {
  if (typeof window === 'undefined') return null
  const mem = projectsListMemCache
  if (mem && mem.userId === userId && Date.now() - mem.cachedAt < TTL_MS) {
    return mem.projects
  }
  const session = getLastProjectsListSync()
  if (session && session.userId === userId) return session.projects
  return null
}

export function getLastProjectsListSync():
  { userId: string; projects: any[] } | null {
  if (typeof window === 'undefined') return null
  const mem = projectsListMemCache
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    return { userId: mem.userId, projects: mem.projects }
  }
  const readEntry = (raw: string | null) => {
    if (!raw) return null
    const entry = JSON.parse(raw) as ProjectsListCacheEntry
    if (!entry?.userId || !Array.isArray(entry.projects) || Date.now() - entry.cachedAt > TTL_MS) return null
    return entry
  }
  try {
    let entry = readEntry(sessionStorage.getItem(PROJECTS_LIST_SESSION_KEY))
    if (!entry && typeof localStorage !== 'undefined') {
      entry = readEntry(localStorage.getItem(PROJECTS_LIST_LOCAL_KEY))
      if (entry) sessionStorage.setItem(PROJECTS_LIST_SESSION_KEY, JSON.stringify(entry))
    }
    if (!entry) return null
    projectsListMemCache = entry
    return { userId: entry.userId, projects: entry.projects }
  } catch {
    return null
  }
}

export async function getCachedProjectsList(
  userId: string,
): Promise<any[] | null> {
  const mem = projectsListMemCache
  if (mem && mem.userId === userId && Date.now() - mem.cachedAt < TTL_MS) {
    return mem.projects
  }

  try {
    const db = await getDB()
    if (!db) return null
    const entry = await new Promise<ProjectsListCacheEntry | null>((resolve) => {
      const tx = db.transaction(PROJECTS_LIST_STORE, 'readonly')
      const req = tx.objectStore(PROJECTS_LIST_STORE).get(userId)
      req.onsuccess = () => resolve(req.result as ProjectsListCacheEntry | null ?? null)
      req.onerror = () => resolve(null)
    })
    if (!entry || Date.now() - entry.cachedAt > TTL_MS) return null
    projectsListMemCache = entry
    return entry.projects
  } catch {
    return null
  }
}

async function writeProjectsListToIDB(entry: ProjectsListCacheEntry): Promise<void> {
  try {
    const db = await getDB()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROJECTS_LIST_STORE, 'readwrite')
      tx.objectStore(PROJECTS_LIST_STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IDB failures are non-critical
  }
}

export function cacheCreateDraft(
  draft: Omit<CreateDraftEntry, 'key' | 'cachedAt'>,
): void {
  const entry: CreateDraftEntry = {
    key: ACTIVE_CREATE_DRAFT_KEY,
    cachedAt: Date.now(),
    ...draft,
  }
  createDraftMemCache = entry
  void writeCreateDraftToIDB(entry)
}

export async function getCreateDraft(): Promise<CreateDraftEntry | null> {
  const mem = createDraftMemCache
  if (mem && Date.now() - mem.cachedAt < TTL_MS) return mem

  try {
    const db = await getDB()
    if (!db) return null
    const entry = await new Promise<CreateDraftEntry | null>((resolve) => {
      const tx = db.transaction(CREATE_DRAFT_STORE, 'readonly')
      const req = tx.objectStore(CREATE_DRAFT_STORE).get(ACTIVE_CREATE_DRAFT_KEY)
      req.onsuccess = () => resolve(req.result as CreateDraftEntry | null ?? null)
      req.onerror = () => resolve(null)
    })
    if (!entry || Date.now() - entry.cachedAt > TTL_MS) return null
    createDraftMemCache = entry
    return entry
  } catch {
    return null
  }
}

export async function clearCreateDraft(): Promise<void> {
  createDraftMemCache = null
  try {
    const db = await getDB()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(CREATE_DRAFT_STORE, 'readwrite')
      tx.objectStore(CREATE_DRAFT_STORE).delete(ACTIVE_CREATE_DRAFT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // IDB failures are non-critical
  }
}

async function writeCreateDraftToIDB(entry: CreateDraftEntry): Promise<void> {
  try {
    const db = await getDB()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CREATE_DRAFT_STORE, 'readwrite')
      tx.objectStore(CREATE_DRAFT_STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IDB failures are non-critical
  }
}

export function clearUserCache(): void {
  projectsListMemCache = null
  projectMemCache.clear()
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(PROJECTS_LIST_SESSION_KEY)
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PROJECTS_LIST_LOCAL_KEY)
    }
  } catch {
    // Web storage failures are non-critical
  }
}
