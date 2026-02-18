'use client'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProject'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import { Snapshot, Message, Tip } from '@/types'
import Editor from '@/components/Editor'

export default function ProjectPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  const { loadProject, saveSnapshot, saveMessage, updateTips, updateCover } =
    useProject(projectId, user?.id ?? '')

  const [initialSnapshots, setInitialSnapshots] = useState<Snapshot[] | null>(null)
  const [initialMessages, setInitialMessages] = useState<Message[] | null>(null)
  const [pendingImage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const pending = sessionStorage.getItem('pendingImage')
    if (pending) sessionStorage.removeItem('pendingImage')
    return pending
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [user, authLoading, router])

  // Load project data on mount
  useEffect(() => {
    if (!user || !projectId || loaded) return

    loadProject().then(({ snapshots, messages }) => {
      setInitialSnapshots(snapshots)
      setInitialMessages(messages)
      setLoaded(true)

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
  }, [user, projectId, loaded, loadProject, updateCover])

  const handleSaveSnapshot = useCallback((snapshot: Snapshot, sortOrder: number) => {
    saveSnapshot(snapshot, sortOrder)
  }, [saveSnapshot])

  const handleSaveMessage = useCallback((message: Message) => {
    saveMessage(message)
  }, [saveMessage])

  const handleUpdateTips = useCallback((snapshotId: string, tips: Tip[]) => {
    updateTips(snapshotId, tips)
  }, [updateTips])

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
      projectId={projectId}
      initialSnapshots={initialSnapshots ?? []}
      initialMessages={initialMessages ?? []}
      pendingImage={pendingImage ?? undefined}
      onSaveSnapshot={handleSaveSnapshot}
      onSaveMessage={handleSaveMessage}
      onUpdateTips={handleUpdateTips}
      onBack={() => router.push('/projects')}
    />
  )
}
