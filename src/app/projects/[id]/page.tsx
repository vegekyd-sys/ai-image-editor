'use client'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProject'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Snapshot, Message, Tip, PhotoMetadata } from '@/types'
import Editor from '@/components/Editor'
import { createClient } from '@/lib/supabase/client'
import { getCachedImages, getCachedProjectData, cacheProjectData, getCachedProjectDataSync } from '@/lib/imageCache'

export default function ProjectPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateDescription, updateCover, updateTitle } =
    useProject(projectId, user?.id ?? '')

  // Synchronous init from memory cache — eliminates spinner on same-session return visits
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
    return sync ? sync.title : '未命名'
  })
  const [pendingImage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const pending = sessionStorage.getItem('pendingImage')
    if (pending) sessionStorage.removeItem('pendingImage')
    return pending
  })
  const [pendingMetadata] = useState<PhotoMetadata | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const raw = sessionStorage.getItem('pendingMetadata')
    if (raw) { sessionStorage.removeItem('pendingMetadata'); try { return JSON.parse(raw) } catch { return undefined } }
    return undefined
  })
  // If memory cache has data, start loaded=true — no spinner at all
  const [loaded, setLoaded] = useState(() => {
    if (typeof window === 'undefined') return false
    return getCachedProjectDataSync(projectId) !== null
  })
  // Tracks whether we've already shown content (cache or Supabase) to avoid double-set
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

  // Effect 1: Load from project cache immediately (no auth dependency)
  // This runs before Supabase fetch and shows Editor instantly on return visits
  useEffect(() => {
    if (pendingImage) return  // New project flow: skip cache, use pendingImage directly
    let cancelled = false
    getCachedProjectData(projectId).then(async (cached) => {
      if (!cached || cancelled || shownRef.current) return
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

  // Effect 2: Fetch from Supabase (runs when user is available)
  // If Effect 1 already showed data, this runs silently in background to update cache
  useEffect(() => {
    if (!user || !projectId) return
    let cancelled = false

    loadProject().then(async ({ snapshots, messages, title }) => {
      if (cancelled) return
      // Always update project cache with fresh Supabase data
      cacheProjectData(projectId, snapshots, messages, title)

      if (shownRef.current) {
        // Already showing from cache — background refresh done, cover update only
        if (snapshots.length > 0 && snapshots[0].imageUrl) {
          updateCover(snapshots[0].imageUrl)
        }
        return
      }

      // Cache was empty or this won the race — show from Supabase
      const patched = await patchFromImageCache(snapshots)
      if (cancelled || shownRef.current) return
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

  const handleSaveSnapshot = useCallback((snapshot: Snapshot, sortOrder: number) => {
    saveSnapshot(snapshot, sortOrder)
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
      // Compress client-side
      const base64 = await new Promise<string>((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
          URL.revokeObjectURL(url)
          const maxSize = 2048
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(img.width * scale)
          canvas.height = Math.round(img.height * scale)
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = reject
        img.src = url
      })
      const supabase = createClient()
      const { data: project, error } = await supabase
        .from('projects')
        .insert({ user_id: user.id, title: 'Untitled' })
        .select('id')
        .single()
      if (error || !project) throw new Error('Failed to create project')
      sessionStorage.setItem('pendingImage', base64)
      router.push(`/projects/${project.id}`)
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
      pendingImage={pendingImage ?? undefined}
      pendingMetadata={pendingMetadata}
      onSaveSnapshot={handleSaveSnapshot}
      onSaveMessage={handleSaveMessage}
      onUpdateTips={handleUpdateTips}
      onUpdateDescription={updateDescription}
      initialTitle={initialTitle}
      onRenameProject={updateTitle}
      onBack={() => router.push('/projects')}
      onNewProject={handleNewProject}
    />
    </div>
  )
}
