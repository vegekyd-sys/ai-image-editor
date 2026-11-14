'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchProjectGalleryPage, mergeProjectGalleryPage, type GalleryProject } from '@/lib/project-gallery'

export function useProjectGallery(options: {
  userId?: string
  refreshKey: number
  currentProjects: () => GalleryProject[]
  responseGeneration?: () => number
  onProjects: (projects: GalleryProject[]) => void
  onInitialError: () => void
}) {
  const { userId, refreshKey } = options
  const callbacks = useRef(options)
  useEffect(() => { callbacks.current = options })
  const request = useRef<AbortController | null>(null)
  const cursor = useRef<string | null | undefined>(undefined)
  const seen = useRef(new Set<string>())
  const owner = useRef(userId)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const loadMore = useCallback(async () => {
    if (!userId || request.current || cursor.current === null) return
    const controller = new AbortController()
    const generation = callbacks.current.responseGeneration?.()
    request.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const page = await fetchProjectGalleryPage({ cursor: cursor.current, signal: controller.signal })
      if (controller.signal.aborted) return
      if (generation !== callbacks.current.responseGeneration?.()) return
      for (const id of page.scannedIds) seen.current.add(id)
      const next = mergeProjectGalleryPage(callbacks.current.currentProjects(), page, seen.current)
      cursor.current = page.nextCursor
      setHasMore(page.nextCursor !== null)
      callbacks.current.onProjects(next)
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('Failed to load projects:', error)
      setFailed(true)
      callbacks.current.onInitialError()
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }, [userId])

  useEffect(() => {
    if (userId && owner.current && userId !== owner.current) callbacks.current.onProjects([])
    if (userId) owner.current = userId
    cursor.current = undefined
    seen.current = new Set()
    setHasMore(false)
    void loadMore()
    return () => {
      request.current?.abort()
      request.current = null
    }
  }, [userId, refreshKey, loadMore])

  return { loadMore, hasMore, loading, failed }
}
