'use client'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProject'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Snapshot, Message, Tip, PhotoMetadata } from '@/types'
import Editor from '@/components/Editor'
import { createClient } from '@/lib/supabase/client'
import { getCachedImages } from '@/lib/imageCache'
import { getProjectFromCache } from '@/app/projects/page'

export default function ProjectPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateDescription, updateCover, updateTitle } =
    useProject(projectId, user?.id ?? '')

  // Check module-level cache for instant load (populated when user came from projects list)
  const cachedProject = typeof window !== 'undefined' ? getProjectFromCache(projectId) : null
  const [initialSnapshots, setInitialSnapshots] = useState<Snapshot[] | null>(() =>
    cachedProject
      ? cachedProject.snapshots.map(s => ({ id: s.id, image: s.image_url, tips: [], messageId: '', imageUrl: s.image_url }))
      : null
  )
  const [initialMessages, setInitialMessages] = useState<Message[] | null>(() => cachedProject ? [] : null)
  const [initialTitle, setInitialTitle] = useState<string>(() => cachedProject?.title ?? '未命名')
  const [editorKey, setEditorKey] = useState<'cache' | 'full'>('cache')
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
  const [loaded, setLoaded] = useState(cachedProject !== null)
  // Prevents double-fetch (StrictMode / re-renders), separate from `loaded` so cache path still fetches
  const fullDataFetchedRef = useRef(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [user, authLoading, router])

  // Load project data on mount
  useEffect(() => {
    if (!user || !projectId || fullDataFetchedRef.current) return
    fullDataFetchedRef.current = true

    loadProject().then(async ({ snapshots, messages, title }) => {
      // Full data arrived — update all state
      // Collect keys for missing images
      const keys: string[] = []
      for (const s of snapshots) {
        if (!s.image) keys.push(`snap:${s.id}`)
        for (const t of s.tips) {
          if (!t.previewImage && t.editPrompt) keys.push(`tip:${s.id}:${t.editPrompt}`)
        }
      }

      let patchedSnapshots = snapshots
      if (keys.length > 0) {
        const cacheMap = await getCachedImages(keys)
        if (cacheMap.size > 0) {
          patchedSnapshots = snapshots.map(s => ({
            ...s,
            image: s.image || (cacheMap.get(`snap:${s.id}`) ?? ''),
            tips: s.tips.map(t => {
              if (t.previewImage || !t.editPrompt) return t
              const cached = cacheMap.get(`tip:${s.id}:${t.editPrompt}`)
              return cached ? { ...t, previewImage: cached, previewStatus: 'done' as const } : t
            }),
          }))
        }
      }

      setInitialSnapshots(patchedSnapshots)
      setInitialMessages(messages)
      setInitialTitle(title)
      setLoaded(true)
      // If we rendered from cache, remount Editor with complete data (tips, messages)
      if (cachedProject) setEditorKey('full')

      // Set cover from first snapshot if available
      if (snapshots.length > 0 && snapshots[0].imageUrl) {
        updateCover(snapshots[0].imageUrl)
      }
    }).catch((err) => {
      console.error('Failed to load project:', err)
      setInitialSnapshots([])
      setInitialMessages([])
      setLoaded(true)
    })
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

  if (authLoading || !loaded) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (!user) return null

  return (
    <Editor
      key={editorKey}
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
  )
}
