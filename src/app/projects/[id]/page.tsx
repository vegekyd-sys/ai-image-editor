'use client'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProject'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Snapshot, Message, Tip, PhotoMetadata, ProjectAnimation } from '@/types'
import Editor from '@/components/Editor'
import { createClient } from '@/lib/supabase/client'
import { createProject } from '@/lib/createProject'
import { getCachedImages, getCachedProjectData, cacheProjectData, getCachedProjectDataSync } from '@/lib/imageCache'

export default function ProjectPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateDescription, updateCover, updateTitle } =
    useProject(projectId, user?.id ?? '')

  // Sync cache for instant render (snapshots + messages from IDB/memory)
  const [initialSnapshots, setInitialSnapshots] = useState<Snapshot[] | null>(() => {
    const sync = getCachedProjectDataSync(projectId)
    return sync ? sync.snapshots as Snapshot[] : null
  })
  const [initialMessages, setInitialMessages] = useState<Message[] | null>(() => {
    const sync = getCachedProjectDataSync(projectId)
    return sync ? sync.messages as Message[] : null
  })
  const [initialTitle, setInitialTitle] = useState<string>(() => {
    const sync = getCachedProjectDataSync(projectId)
    return sync ? sync.title : 'Untitled'
  })
  const [initialAnimations, setInitialAnimations] = useState<ProjectAnimation[]>([])
  const [pendingImages] = useState<string[] | null>(() => {
    if (typeof window === 'undefined') return null
    // New multi-image path
    const multi = sessionStorage.getItem('pendingImages')
    if (multi) {
      sessionStorage.removeItem('pendingImages')
      try { return JSON.parse(multi) as string[] } catch { return null }
    }
    // Legacy single-image fallback
    const single = sessionStorage.getItem('pendingImage')
    if (single) {
      sessionStorage.removeItem('pendingImage')
      return [single]
    }
    return null
  })
  const [pendingMetadata] = useState<PhotoMetadata | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const raw = sessionStorage.getItem('pendingMetadata')
    if (raw) { sessionStorage.removeItem('pendingMetadata'); try { return JSON.parse(raw) } catch { return undefined } }
    return undefined
  })
  const [pendingPrompt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const p = sessionStorage.getItem('pendingPrompt')
    if (p) sessionStorage.removeItem('pendingPrompt')
    return p
  })
  const [pendingSkill] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const s = sessionStorage.getItem('pendingSkill')
    if (s) sessionStorage.removeItem('pendingSkill')
    return s
  })
  // GUI can render immediately if snapshot cache exists
  const [loaded, setLoaded] = useState(() => {
    if (typeof window === 'undefined') return false
    const sync = getCachedProjectDataSync(projectId)
    return sync !== null && (sync.snapshots as Snapshot[]).length > 0
  })
  const shownRef = useRef(loaded)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [user, authLoading, router])

  // Helper: patch missing images from IndexedDB image cache
  async function patchFromImageCache(snapshots: Snapshot[]): Promise<Snapshot[]> {
    const keys: string[] = []
    for (const s of snapshots) {
      if (!s.image) keys.push(`snap:${s.id}`)
      for (const t of s.tips) {
        if (!t.previewImage && t.editPrompt) keys.push(`tip:${s.id}:${t.editPrompt}`)
      }
    }
    if (keys.length === 0) return snapshots
    const cacheMap = await getCachedImages(keys)
    if (cacheMap.size === 0) return snapshots
    return snapshots.map(s => ({
      ...s,
      image: s.image || (cacheMap.get(`snap:${s.id}`) ?? ''),
      tips: s.tips.map(t => {
        if (t.previewImage || !t.editPrompt) return t
        const cached = cacheMap.get(`tip:${s.id}:${t.editPrompt}`)
        return cached ? { ...t, previewImage: cached, previewStatus: 'done' as const } : t
      }),
    }))
  }

  // DISABLED: Effect 1 (cache) — always wait for Supabase to ensure data consistency
  // TODO: Re-enable with proper cache invalidation when background agent is active
  // useEffect(() => {
  //   if (pendingImages) return
  // Effect 1: Load from IDB cache (no auth needed, fast)
  useEffect(() => {
    if (pendingImages || shownRef.current) return
    let cancelled = false
    getCachedProjectData(projectId).then(async (cached) => {
      if (!cached || cancelled || shownRef.current) return
      if ((cached.snapshots as Snapshot[]).length === 0) return
      const patched = await patchFromImageCache(cached.snapshots as Snapshot[])
      if (cancelled || shownRef.current) return
      shownRef.current = true
      setInitialSnapshots(patched)
      setInitialMessages(cached.messages as Message[])
      setInitialTitle(cached.title)
      setLoaded(true)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Effect 2: Fetch from Supabase — always updates all data
  useEffect(() => {
    if (!user || !projectId) return
    let cancelled = false

    loadProject().then(async ({ snapshots, messages, title, animations }) => {
      if (cancelled) return
      cacheProjectData(projectId, snapshots, messages, title)

      if (animations.length > 0) {
        setInitialAnimations(animations)
      }

      const patched = await patchFromImageCache(snapshots)
      if (cancelled) return
      shownRef.current = true
      setInitialSnapshots(patched)
      setInitialMessages(messages)
      setInitialTitle(title)
      setLoaded(true)

      if (snapshots.length > 0 && snapshots[0].imageUrl) {
        updateCover(snapshots[0].imageUrl)
      }
    }).catch((err) => {
      if (cancelled) return
      console.error('Failed to load project:', err)
      if (!shownRef.current) {
        // No cache + no network: show empty editor
        shownRef.current = true
        setInitialSnapshots([])
        setInitialMessages([])
        setLoaded(true)
      }
      // If cache already showed something, stay on it (offline mode)
    })

    return () => { cancelled = true }
  }, [user, projectId, loadProject, updateCover])

  const handleSaveSnapshot = useCallback((snapshot: Snapshot, sortOrder: number, onUploaded?: (imageUrl: string) => void) => {
    saveSnapshot(snapshot, sortOrder, onUploaded)
  }, [saveSnapshot])

  const handleSaveMessage = useCallback((message: Message) => {
    saveMessage(message)
  }, [saveMessage])

  const handleUpdateTips = useCallback((snapshotId: string, tips: Tip[]) => {
    updateTips(snapshotId, tips)
  }, [updateTips])

  const handleNewProject = useCallback(async (file: File) => {
    if (!user) return
    try {
      const supabase = createClient()
      const result = await createProject(supabase, user.id, [file])
      if (!result) throw new Error('Failed to create project')
      router.push(`/projects/${result.projectId}`)
    } catch (err) {
      console.error('New project error:', err)
    }
  }, [user, router])

  if (!loaded) {
    return (
      <div className="page-slide-in h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="page-slide-in">
    <Editor
      projectId={projectId}
      initialSnapshots={initialSnapshots ?? []}
      initialMessages={initialMessages ?? []}
      pendingImages={pendingImages ?? undefined}
      pendingMetadata={pendingMetadata}
      pendingPrompt={pendingPrompt ?? undefined}
      pendingSkill={pendingSkill ?? undefined}
      onSaveSnapshot={handleSaveSnapshot}
      onSaveMessage={handleSaveMessage}
      onUpdateTips={handleUpdateTips}
      onUpdateDescription={updateDescription}
      initialTitle={initialTitle}
      onRenameProject={updateTitle}
      onBack={() => router.push('/projects')}
      onNewProject={handleNewProject}
      initialAnimations={initialAnimations}
    />
    </div>
  )
}
