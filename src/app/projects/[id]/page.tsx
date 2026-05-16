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
  const navigatingRef = useRef(false)
  const params = useParams()
  const projectId = params.id as string

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateDescription, updateCover, updateTitle, saveDesignProps } =
    useProject(projectId, user?.id ?? '')

  // Project visibility state
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null)
  const [isPublicProject, setIsPublicProject] = useState<boolean | null>(null)

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
  const [timelineVersion, setTimelineVersion] = useState(2)
  const [initialMusicTaskId, setInitialMusicTaskId] = useState<string | null>(null)
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
  const [pendingVideos] = useState<Array<{ videoUrl: string; duration: number; width: number; height: number }> | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem('pendingVideos')
    if (raw) { sessionStorage.removeItem('pendingVideos'); try { return JSON.parse(raw) } catch { return null } }
    return null
  })
  const isNewProject = !!(pendingImages || pendingPrompt || pendingVideos)
  // GUI can render immediately if snapshot cache exists or this is a new project
  const [loaded, setLoaded] = useState(() => {
    if (typeof window === 'undefined') return false
    if (isNewProject) return true
    const sync = getCachedProjectDataSync(projectId)
    return sync !== null && (sync.snapshots as Snapshot[]).length > 0
  })
  const shownRef = useRef(loaded)

  // Check project visibility (works for both authenticated and unauthenticated users)
  useEffect(() => {
    if (authLoading) return
    const supabase = createClient()
    supabase
      .from('projects')
      .select('user_id, is_public')
      .eq('id', projectId)
      .single()
      .then(({ data }) => {
        if (data) {
          setProjectOwnerId(data.user_id)
          setIsPublicProject(data.is_public)
        } else {
          // Not found or not accessible (private + not owner)
          if (!user) {
            sessionStorage.setItem('mkr_return_url', `/projects/${projectId}`)
            router.replace('/login')
          } else {
            router.replace('/projects')
          }
        }
      })
  }, [projectId, authLoading, user, router])

  // Redirect if project is private and user is not the owner
  useEffect(() => {
    if (authLoading || isPublicProject === null) return
    if (!isPublicProject && (!user || user.id !== projectOwnerId)) {
      if (!user) sessionStorage.setItem('mkr_return_url', `/projects/${projectId}`)
      router.replace(user ? '/projects' : '/login')
    }
  }, [authLoading, isPublicProject, user, projectOwnerId, router])

  const isOwner = user?.id === projectOwnerId
  const readOnly = !isOwner

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

  // Effect 2: Fetch from Supabase via loadProject
  // For owner: needs userId. For public projects: anon client can read via RLS.
  const userId = user?.id
  useEffect(() => {
    if (!projectId) return
    if (isNewProject) return
    // Wait until we know visibility; for owners wait for userId
    if (isPublicProject === null) return
    if (!isPublicProject && !userId) return

    let cancelled = false
    const pageT0 = performance.now()
    loadProject().then(async ({ snapshots, messages, title, animations, timelineVersion: tv }) => {
      console.log(`⏱️ [page] loadProject done: ${(performance.now() - pageT0).toFixed(0)}ms`)
      if (cancelled) return
      if (userId) cacheProjectData(projectId, snapshots, messages, title)
      setTimelineVersion(tv)

      if (animations.length > 0) {
        setInitialAnimations(animations)
      }

      // Restore music from project_music
      const supabase = createClient()
      const { data: musicRows } = await supabase
        .from('project_music')
        .select('suno_task_id, track_index, audio_url, duration, title, tags, status')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (musicRows?.length && !cancelled) {
        // Resume polling for pending/processing tasks
        const pendingTask = musicRows.find(r => r.status === 'pending' || r.status === 'processing')
        if (pendingTask) {
          setInitialMusicTaskId(pendingTask.suno_task_id)
        }
        // Restore completed tracks to messages
        const completedRows = musicRows.filter(r => r.status === 'completed' && r.audio_url)
        const hasMusic = messages.some(m => m.content?.includes('music:'))
        if (completedRows.length && !hasMusic) {
          const musicLines = completedRows.map(r =>
            `music:${r.track_index}|${r.title || ''}|${Math.round(Number(r.duration))}|${r.tags || ''}|${r.audio_url}`
          ).join('\n')
          messages.push({ id: 'music-restore', role: 'assistant', content: `🎵\n${musicLines}`, timestamp: Date.now() })
        }
      }

      console.log(`⏱️ [page] music query done: ${(performance.now() - pageT0).toFixed(0)}ms`)
      const patched = await patchFromImageCache(snapshots)
      console.log(`⏱️ [page] patchFromImageCache done: ${(performance.now() - pageT0).toFixed(0)}ms`)
      if (cancelled) return
      shownRef.current = true
      setInitialSnapshots(patched)
      setInitialMessages(messages)
      setInitialTitle(title)
      setLoaded(true)

      if (userId && snapshots.length > 0 && snapshots[0].imageUrl) {
        updateCover(snapshots[0].imageUrl)
      }
    }).catch((err: unknown) => {
      if (cancelled) return
      console.error('Failed to load project:', err)
      if (!shownRef.current) {
        shownRef.current = true
        setInitialSnapshots([])
        setInitialMessages([])
        setLoaded(true)
      }
    })

    return () => { cancelled = true }
  }, [userId, projectId, loadProject, updateCover, isPublicProject])

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
      pendingImages={!readOnly ? (pendingImages ?? undefined) : undefined}
      pendingVideos={!readOnly ? (pendingVideos ?? undefined) : undefined}
      pendingMetadata={!readOnly ? pendingMetadata : undefined}
      pendingPrompt={!readOnly ? (pendingPrompt ?? undefined) : undefined}
      pendingSkill={!readOnly ? (pendingSkill ?? undefined) : undefined}
      onSaveSnapshot={!readOnly ? handleSaveSnapshot : undefined}
      onSaveMessage={!readOnly ? handleSaveMessage : undefined}
      onUpdateTips={!readOnly ? handleUpdateTips : undefined}
      onUpdateDescription={!readOnly ? updateDescription : undefined}
      onSaveDesignProps={!readOnly ? saveDesignProps : undefined}
      initialTitle={initialTitle}
      onRenameProject={!readOnly ? updateTitle : undefined}
      onBack={() => { if (navigatingRef.current) return; navigatingRef.current = true; router.push(user ? '/projects' : '/home'); }}
      onNewProject={!readOnly ? handleNewProject : undefined}
      initialAnimations={initialAnimations}
      timelineVersion={timelineVersion}
      initialMusicTaskId={initialMusicTaskId}
      readOnly={readOnly}
    />
    </div>
  )
}
