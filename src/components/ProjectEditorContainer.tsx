'use client'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProject'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Snapshot, Message, Tip, PhotoMetadata, ProjectAnimation } from '@/types'
import Editor from '@/components/Editor'
import { createClient } from '@/lib/supabase/client'
import { createProject } from '@/lib/createProject'
import { getCachedImages, getCachedProjectData, cacheProjectData, getCachedProjectDataSync } from '@/lib/imageCache'

interface ProjectEditorContainerProps {
  projectId: string
  className?: string
  loadingClassName?: string
  onBack?: () => void
  onProjectCreated?: (projectId: string) => void
  disableAgentLiveReload?: boolean
  disableBodyScrollLock?: boolean
  isInlineActive?: boolean
}

export default function ProjectEditorContainer({
  projectId,
  className = 'page-slide-in',
  loadingClassName = 'page-slide-in h-dvh flex items-center justify-center relative z-[1]',
  onBack,
  onProjectCreated,
  disableAgentLiveReload = false,
  disableBodyScrollLock = false,
  isInlineActive = true,
}: ProjectEditorContainerProps) {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const navigatingRef = useRef(false)
  const leaveEditor = useCallback((path: '/projects' | '/login') => {
    if (onBack) {
      onBack()
      return
    }
    router.replace(path)
  }, [onBack, router])

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateDescription, updateTitle, saveDesignProps } =
    useProject(projectId, user?.id ?? '')

  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null)
  const [isPublicProject, setIsPublicProject] = useState<boolean | null>(null)

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
    const multi = sessionStorage.getItem('pendingImages')
    if (multi) {
      sessionStorage.removeItem('pendingImages')
      try { return JSON.parse(multi) as string[] } catch { return null }
    }
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
  const [loaded, setLoaded] = useState(() => {
    if (typeof window === 'undefined') return false
    if (isNewProject) return true
    const sync = getCachedProjectDataSync(projectId)
    return sync !== null && (sync.snapshots as Snapshot[]).length > 0
  })
  const shownRef = useRef(loaded)

  useEffect(() => {
    if (!isInlineActive) return
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
        } else if (!user) {
          sessionStorage.setItem('mkr_return_url', `/projects/${projectId}`)
          leaveEditor('/login')
        } else {
          leaveEditor('/projects')
        }
      })
  }, [projectId, authLoading, user, leaveEditor, isInlineActive])

  useEffect(() => {
    if (!isInlineActive) return
    if (authLoading || isPublicProject === null) return
    if (!isPublicProject && (!user || user.id !== projectOwnerId)) {
      if (!user) sessionStorage.setItem('mkr_return_url', `/projects/${projectId}`)
      leaveEditor(user ? '/projects' : '/login')
    }
  }, [authLoading, isPublicProject, user, projectOwnerId, projectId, leaveEditor, isInlineActive])

  const isOwner = user?.id === projectOwnerId
  const readOnly = !isOwner

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

  useEffect(() => {
    if (!isInlineActive) return
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
  }, [projectId, isInlineActive])

  const userId = user?.id
  useEffect(() => {
    if (!isInlineActive) return
    if (!projectId) return
    if (isNewProject) return
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

      const supabase = createClient()
      const { data: musicRows } = await supabase
        .from('project_music')
        .select('suno_task_id, track_index, audio_url, duration, title, tags, status')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (musicRows?.length && !cancelled) {
        const pendingTask = musicRows.find(r => r.status === 'pending' || r.status === 'processing')
        if (pendingTask) {
          setInitialMusicTaskId(pendingTask.suno_task_id)
        }
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
  }, [userId, projectId, loadProject, isPublicProject, isNewProject, isInlineActive])

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
      if (onProjectCreated) {
        onProjectCreated(result.projectId)
      } else {
        router.push(`/projects/${result.projectId}`)
      }
    } catch (err) {
      console.error('New project error:', err)
    }
  }, [user, router, onProjectCreated])

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack()
      return
    }
    if (navigatingRef.current) return
    navigatingRef.current = true
    router.push(user ? '/projects' : '/home')
  }, [onBack, router, user])

  if (!loaded) {
    return (
      <div className={loadingClassName}>
        <div className="makaron-editor-shell h-dvh w-full bg-black text-white relative overflow-hidden">
          <style>{`
            @keyframes makaron-editor-loading-shimmer {
              0% { background-position: 180% 0; }
              100% { background-position: -80% 0; }
            }
            .makaron-editor-loading-shimmer {
              background: linear-gradient(105deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.055) 38%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0.055) 62%, rgba(255,255,255,0.035) 100%);
              background-size: 260% 100%;
              animation: makaron-editor-loading-shimmer 1.65s ease-in-out infinite;
            }
          `}</style>
          <div className="absolute inset-x-0 top-0 bottom-[164px] bg-black">
            <div className="absolute inset-0 makaron-editor-loading-shimmer opacity-70" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/12 via-transparent to-black/18" />
          </div>
          <div className="makaron-editor-topbar absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-1">
              <div className="p-2 text-white/70">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </div>
              <div className="p-2 text-white/55">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className="p-2 text-white/45">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                  <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                </svg>
              </div>
              <div className="p-2 text-white/40">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 16H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z" />
                  <circle cx="12" cy="11.5" r="1.5" />
                  <path d="M20 8a8.5 8.5 0 0 0-3-3.5" />
                  <path d="M20 8l-2.5-.5L18 10" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full makaron-editor-loading-shimmer opacity-65" />
              <div className="h-8 w-16 rounded-full makaron-editor-loading-shimmer opacity-80" />
            </div>
          </div>
          <div className="makaron-editor-bottom-bar absolute left-0 right-0 bottom-0 z-10 flex-shrink-0 bg-gradient-to-t from-black from-70% via-black/95 to-transparent">
            <div className="flex items-center gap-3 px-4 py-2 min-h-[44px]">
              <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400/80 flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-3 w-[54%] rounded-full makaron-editor-loading-shimmer opacity-70" />
              </div>
              <div className="h-8 w-16 rounded-full makaron-editor-loading-shimmer opacity-65" />
            </div>
            <div className="flex items-end gap-2 px-3 pt-2 pb-1.5 overflow-hidden min-h-[78px]">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-[200px] flex-shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]"
                >
                  <div className="flex">
                    <div className="h-[72px] w-[72px] flex-shrink-0 makaron-editor-loading-shimmer opacity-75" />
                    <div className="flex-1 px-2.5 py-2 flex flex-col justify-center gap-2">
                      <div className="h-3.5 w-[72%] rounded-full makaron-editor-loading-shimmer opacity-75" />
                      <div className="h-2.5 w-[94%] rounded-full makaron-editor-loading-shimmer opacity-55" />
                      <div className="h-2.5 w-[58%] rounded-full makaron-editor-loading-shimmer opacity-45" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-10 h-[34px] text-white/35">
              <div className="h-3 w-16 rounded-full makaron-editor-loading-shimmer opacity-75" />
              <div className="h-3 w-14 rounded-full makaron-editor-loading-shimmer opacity-45" />
              <div className="h-3 w-12 rounded-full makaron-editor-loading-shimmer opacity-35" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
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
        onBack={handleBack}
        onNewProject={!readOnly ? handleNewProject : undefined}
        initialAnimations={initialAnimations}
        timelineVersion={timelineVersion}
        initialMusicTaskId={initialMusicTaskId}
        readOnly={readOnly}
        disableAgentLiveReload={disableAgentLiveReload}
        disableBodyScrollLock={disableBodyScrollLock}
        inactive={!isInlineActive}
      />
    </div>
  )
}
