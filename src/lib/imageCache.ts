import type { SkillLaunchContext } from '@/lib/skill-launch-context'

const DB_NAME = 'makaron-images'
const STORE = 'images'
const PROJECT_STORE = 'project-data'
const PROJECTS_LIST_STORE = 'projects-list'
const PROJECTS_LIST_SESSION_KEY = 'makaron:last-projects-list'
const PROJECTS_LIST_LOCAL_KEY = 'makaron:last-projects-list:persistent'
const CREATE_DRAFT_STORE = 'create-drafts'
const ACTIVE_CREATE_DRAFT_KEY = 'active'
const CREATE_DRAFT_CONTINUATION_KEY = 'makaron:create-draft-continuation'
const PENDING_PROJECT_IMAGES_KEY = 'makaron:pending-project-images'
const PENDING_PROJECT_LAUNCH_PREFIX = 'makaron:pending-project-launch:'
const MEDIA_BLOB_STORE = 'media-blobs'
const TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const MAX_MEDIA_BLOB_BYTES = 32 * 1024 * 1024

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

interface MediaBlobCacheEntry {
  key: string
  blob: Blob
  contentType: string
  cachedAt: number
}

export interface CreateDraftEntry {
  key: string
  images: string[]
  projectId?: string
  continuationId?: string
  metadata?: unknown
  prompt?: string
  selectedSkill?: string
  homeSkillId?: string
  skillLaunchContext?: SkillLaunchContext
  returnPath?: string
  cachedAt: number
}

export interface PendingProjectLaunch {
  projectId: string
  prompt?: string
  skill?: string
  skillLaunchContext?: SkillLaunchContext
  metadata?: unknown
  cachedAt: number
}

// In-memory layer: synchronous, survives client-side navigation within the same tab session
const memoryCache = new Map<string, string>()
const projectMemCache = new Map<string, ProjectCacheEntry>()
let projectsListMemCache: ProjectsListCacheEntry | null = null
let createDraftMemCache: CreateDraftEntry | null = null
const pendingProjectLaunchMemCache = new Map<string, PendingProjectLaunch>()
const mediaObjectUrlCache = new Map<string, { url: string; cachedAt: number }>()
const mediaFetchInFlight = new Map<string, Promise<string | null>>()

// IDB layer: persistent across tab close/reopen
let dbPromise: Promise<IDBDatabase | null> | null = null

function createDraftProjectId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 6)
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
        if (!db.objectStoreNames.contains(MEDIA_BLOB_STORE)) {
          db.createObjectStore(MEDIA_BLOB_STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { dbPromise = null; reject(req.error) }
    })
  }
  return dbPromise
}

export function mediaCacheKeyForUrl(url: string): string {
  return `media:${url}`
}

export async function getCachedMediaObjectUrl(key: string): Promise<string | null> {
  const mem = mediaObjectUrlCache.get(key)
  if (mem && Date.now() - mem.cachedAt < TTL_MS) return mem.url

  try {
    const db = await getDB()
    if (!db || !db.objectStoreNames.contains(MEDIA_BLOB_STORE)) return null
    const entry = await new Promise<MediaBlobCacheEntry | null>((resolve) => {
      const tx = db.transaction(MEDIA_BLOB_STORE, 'readonly')
      const req = tx.objectStore(MEDIA_BLOB_STORE).get(key)
      req.onsuccess = () => resolve(req.result as MediaBlobCacheEntry | null ?? null)
      req.onerror = () => resolve(null)
    })
    if (!entry || Date.now() - entry.cachedAt > TTL_MS) return null
    const url = URL.createObjectURL(entry.blob)
    mediaObjectUrlCache.set(key, { url, cachedAt: Date.now() })
    return url
  } catch {
    return null
  }
}

async function writeMediaBlobToIDB(entry: MediaBlobCacheEntry): Promise<void> {
  try {
    const db = await getDB()
    if (!db || !db.objectStoreNames.contains(MEDIA_BLOB_STORE)) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA_BLOB_STORE, 'readwrite')
      tx.objectStore(MEDIA_BLOB_STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Media cache failures should never block the UI.
  }
}

export async function cacheMediaBlob(
  key: string,
  blob: Blob,
  contentType = blob.type || 'application/octet-stream',
): Promise<string | null> {
  if (blob.size === 0 || blob.size > MAX_MEDIA_BLOB_BYTES) return null
  await writeMediaBlobToIDB({
    key,
    blob,
    contentType,
    cachedAt: Date.now(),
  })
  const objectUrl = URL.createObjectURL(blob)
  mediaObjectUrlCache.set(key, { url: objectUrl, cachedAt: Date.now() })
  return objectUrl
}

export async function cacheMediaUrl(url: string, key = mediaCacheKeyForUrl(url)): Promise<string | null> {
  const cached = await getCachedMediaObjectUrl(key)
  if (cached) return cached

  const inFlight = mediaFetchInFlight.get(key)
  if (inFlight) return inFlight

  const task = fetch(url, { credentials: 'omit' })
    .then(async (res) => {
      if (!res.ok) return null
      const blob = await res.blob()
      return cacheMediaBlob(key, blob, blob.type || res.headers.get('content-type') || 'application/octet-stream')
    })
    .catch(() => null)
    .finally(() => {
      mediaFetchInFlight.delete(key)
    })

  mediaFetchInFlight.set(key, task)
  return task
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

interface PendingProjectImagesManifest {
  projectId: string
  keys: string[]
}

function readPendingProjectImagesManifest(projectId: string): PendingProjectImagesManifest | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PENDING_PROJECT_IMAGES_KEY)
    if (!raw) return null
    const manifest = JSON.parse(raw) as PendingProjectImagesManifest
    if (manifest.projectId !== projectId || !Array.isArray(manifest.keys) || manifest.keys.length === 0) return null
    return manifest
  } catch {
    return null
  }
}

export async function stagePendingProjectImages(projectId: string, images: string[]): Promise<void> {
  if (typeof window === 'undefined' || images.length === 0) return
  const keys = images.map((_, index) => `pending-project:${projectId}:${index}`)
  images.forEach((image, index) => memoryCache.set(keys[index], image))
  await Promise.all(images.map((image, index) => writeToIDB(keys[index], image)))
  sessionStorage.setItem(PENDING_PROJECT_IMAGES_KEY, JSON.stringify({ projectId, keys }))
}

export function hasPendingProjectImages(projectId: string): boolean {
  return readPendingProjectImagesManifest(projectId) !== null
}

export function getPendingProjectImagesSync(projectId: string): string[] | null {
  const manifest = readPendingProjectImagesManifest(projectId)
  if (!manifest) return null
  const images = manifest.keys.map(key => memoryCache.get(key))
  return images.every((image): image is string => typeof image === 'string') ? images : null
}

export async function getPendingProjectImages(projectId: string): Promise<string[] | null> {
  const manifest = readPendingProjectImagesManifest(projectId)
  if (!manifest) return null
  const cached = await getCachedImages(manifest.keys)
  const images = manifest.keys.map(key => cached.get(key))
  return images.every((image): image is string => typeof image === 'string') ? images : null
}

export function clearPendingProjectImages(projectId: string): void {
  const manifest = readPendingProjectImagesManifest(projectId)
  if (!manifest) return
  sessionStorage.removeItem(PENDING_PROJECT_IMAGES_KEY)
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
    projectId: draft.projectId || createDraftProjectId(),
  }
  createDraftMemCache = entry
  void writeCreateDraftToIDB(entry)
}

export function beginCreateDraftContinuation(): string {
  const continuationId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  try {
    sessionStorage.setItem(CREATE_DRAFT_CONTINUATION_KEY, continuationId)
    localStorage.setItem(CREATE_DRAFT_CONTINUATION_KEY, continuationId)
  } catch {
    // The in-memory draft remains usable in the current page session.
  }
  return continuationId
}

export function getCreateDraftContinuationId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(CREATE_DRAFT_CONTINUATION_KEY)
      || localStorage.getItem(CREATE_DRAFT_CONTINUATION_KEY)
  } catch {
    return null
  }
}

export function shouldConsumeCreateDraft(
  draft: CreateDraftEntry | null,
  continuationId: string | null,
): draft is CreateDraftEntry {
  return Boolean(draft && continuationId && draft.continuationId === continuationId)
}

export function clearCreateDraftContinuation(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(CREATE_DRAFT_CONTINUATION_KEY)
    localStorage.removeItem(CREATE_DRAFT_CONTINUATION_KEY)
  } catch {
    // Storage cleanup is best-effort.
  }
}

export async function getCreateDraft(): Promise<CreateDraftEntry | null> {
  const mem = createDraftMemCache
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    if (!mem.projectId) {
      mem.projectId = createDraftProjectId()
      void writeCreateDraftToIDB(mem)
    }
    return mem
  }

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
    if (!entry.projectId) {
      entry.projectId = createDraftProjectId()
      void writeCreateDraftToIDB(entry)
    }
    createDraftMemCache = entry
    return entry
  } catch {
    return null
  }
}

export async function clearCreateDraft(): Promise<void> {
  createDraftMemCache = null
  clearCreateDraftContinuation()
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

function pendingProjectLaunchKey(projectId: string): string {
  return `${PENDING_PROJECT_LAUNCH_PREFIX}${projectId}`
}

export function stagePendingProjectLaunch(
  projectId: string,
  launch: Omit<PendingProjectLaunch, 'projectId' | 'cachedAt'>,
): void {
  const entry: PendingProjectLaunch = {
    projectId,
    cachedAt: Date.now(),
    ...launch,
  }
  pendingProjectLaunchMemCache.set(projectId, entry)
  if (typeof window === 'undefined') return
  try {
    const serialized = JSON.stringify(entry)
    sessionStorage.setItem(pendingProjectLaunchKey(projectId), serialized)
    localStorage.setItem(pendingProjectLaunchKey(projectId), serialized)
  } catch {
    // The in-memory handoff still covers client-side navigation.
  }
}

export function getPendingProjectLaunchSync(projectId: string): PendingProjectLaunch | null {
  const cached = pendingProjectLaunchMemCache.get(projectId)
  if (cached && Date.now() - cached.cachedAt < TTL_MS) return cached
  if (typeof window === 'undefined') return null

  try {
    const key = pendingProjectLaunchKey(projectId)
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as PendingProjectLaunch
    if (entry.projectId !== projectId || Date.now() - entry.cachedAt >= TTL_MS) {
      sessionStorage.removeItem(key)
      localStorage.removeItem(key)
      return null
    }
    pendingProjectLaunchMemCache.set(projectId, entry)
    return entry
  } catch {
    return null
  }
}

export function clearPendingProjectLaunch(projectId: string): void {
  pendingProjectLaunchMemCache.delete(projectId)
  if (typeof window === 'undefined') return
  try {
    const key = pendingProjectLaunchKey(projectId)
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    // Storage cleanup is best-effort.
  }
}

export function clearPendingProjectLaunches(): void {
  pendingProjectLaunchMemCache.clear()
  if (typeof window === 'undefined') return
  try {
    for (const storage of [sessionStorage, localStorage]) {
      const keys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(PENDING_PROJECT_LAUNCH_PREFIX)) keys.push(key)
      }
      keys.forEach((key) => storage.removeItem(key))
    }
  } catch {
    // Storage cleanup is best-effort.
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
