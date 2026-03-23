'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getCachedImages, getCachedProjectsListSync, getCachedProjectsList, cacheProjectsList } from '@/lib/imageCache'
import { ensureDecodableFile, isHeicFile } from '@/lib/imageUtils'
import { useLocale, LocaleToggle } from '@/lib/i18n'
import { getThumbnailUrl } from '@/lib/supabase/storage'
import RollingTagline from '@/components/RollingTagline'

interface ProjectWithSnapshots {
  id: string
  title: string
  cover_url: string | null
  updated_at: string
  created_at: string
  snapshots: { id: string; image_url: string; sort_order: number }[]
  hasVideo?: boolean
}

function compressClientSide(file: File, maxSize = 2048, quality = 0.92): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, maxSize / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export default function ProjectsPage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const { t } = useLocale()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  // Phase 1: Synchronous memory cache — same-session instant render
  const [projects, setProjects] = useState<ProjectWithSnapshots[]>(() => {
    if (typeof window === 'undefined') return []
    const userId = user?.id
    if (!userId) return []
    return (getCachedProjectsListSync(userId) as ProjectWithSnapshots[]) ?? []
  })
  const [loadingProjects, setLoadingProjects] = useState(() => {
    if (typeof window === 'undefined') return true
    const userId = user?.id
    if (!userId) return true
    return getCachedProjectsListSync(userId) === null
  })
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputBoxRef = useRef<HTMLDivElement>(null)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [inputText, setInputText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachedPreviews, setAttachedPreviews] = useState<(string | null)[]>([])
  const MAX_FILES = 10

  // Shared helper: process new files and append to attached arrays
  const addFiles = useCallback(async (newFiles: File[]) => {
    if (creating || newFiles.length === 0) return
    for (const file of newFiles) {
      // Check limit using latest state
      let atLimit = false
      setAttachedFiles(prev => {
        if (prev.length >= MAX_FILES) { atLimit = true; return prev }
        return prev
      })
      if (atLimit) break

      if (isHeicFile(file)) {
        // Append file + null preview immediately (shows spinner)
        setAttachedFiles(prev => [...prev, file].slice(0, MAX_FILES))
        setAttachedPreviews(prev => [...prev, null].slice(0, MAX_FILES))
        try {
          const decodable = await ensureDecodableFile(file)
          const previewUrl = URL.createObjectURL(decodable)
          // Replace the last-added HEIC entry with the decoded version
          setAttachedFiles(prev => {
            const idx = prev.indexOf(file)
            if (idx === -1) return prev
            return prev.map((f, i) => i === idx ? decodable : f)
          })
          setAttachedPreviews(prev => {
            // Find the matching null slot from the end
            const idx = prev.lastIndexOf(null)
            if (idx === -1) return prev
            return prev.map((p, i) => i === idx ? previewUrl : p)
          })
        } catch {
          setAttachedPreviews(prev => {
            const idx = prev.lastIndexOf(null)
            if (idx === -1) return prev
            return prev.map((p, i) => i === idx ? 'heic-pending' : p)
          })
        }
      } else {
        const previewUrl = URL.createObjectURL(file)
        setAttachedFiles(prev => [...prev, file].slice(0, MAX_FILES))
        setAttachedPreviews(prev => [...prev, previewUrl].slice(0, MAX_FILES))
      }
    }
  }, [creating])
  const [actionSheet, setActionSheet] = useState<ProjectWithSnapshots | null>(null)
  const [navigating, setNavigating] = useState(false)
  const shownRef = useRef(!loadingProjects) // tracks whether we've shown content

  const [renameValue, setRenameValue] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const openActionSheet = useCallback((e: React.MouseEvent, project: ProjectWithSnapshots) => {
    e.stopPropagation()
    setActionSheet(project)
    setRenameValue(project.title)
    setRenameMode(false)
  }, [])

  const handleDelete = useCallback(() => {
    if (!actionSheet) return
    // Optimistic: remove from UI and close sheet immediately
    const projectId = actionSheet.id
    setProjects(prev => prev.filter(p => p.id !== projectId))
    setActionSheet(null)
    // Delete from DB in background (fire-and-forget)
    Promise.resolve().then(async () => {
      try {
        const supabase = createClient()
        await Promise.all([
          supabase.from('messages').delete().eq('project_id', projectId),
          supabase.from('snapshots').delete().eq('project_id', projectId),
        ])
        await supabase.from('projects').delete().eq('id', projectId)
      } catch (err) {
        console.error('Delete project error:', err)
      }
    })
  }, [actionSheet])

  const handleRename = useCallback(async () => {
    if (!actionSheet || !renameValue.trim()) return
    const newTitle = renameValue.trim()
    const supabase = createClient()
    await supabase.from('projects').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', actionSheet.id)
    setProjects(prev => prev.map(p => p.id === actionSheet.id ? { ...p, title: newTitle } : p))
    setActionSheet(null)
  }, [actionSheet, renameValue])

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login')
  }, [user, authLoading, router])

  // Measure input box height → set photo slot width = height (square)
  useEffect(() => {
    const el = inputBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setPhotoSlotWidth(Math.round(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Phase 2: Async IndexedDB cache (cross-session persistence, no auth dependency)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    getCachedProjectsList(user.id).then((cached) => {
      if (cancelled || shownRef.current || !cached) return
      shownRef.current = true
      setProjects(cached as ProjectWithSnapshots[])
      setLoadingProjects(false)
    })
    return () => { cancelled = true }
  }, [user])

  // Phase 3: Supabase fetch (always runs when user is available, refreshes cache)
  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    let cancelled = false

    async function fetchProjects() {
      try {
        const { data: projectRows, error: pErr } = await supabase
          .from('projects')
          .select('id, title, cover_url, updated_at, created_at')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })

        if (cancelled) return

        if (pErr || !projectRows) {
          console.error('Failed to fetch projects:', pErr)
          if (!shownRef.current) setLoadingProjects(false)
          return
        }

        if (projectRows.length === 0) {
          cacheProjectsList(user!.id, [])
          shownRef.current = true
          setProjects([])
          setLoadingProjects(false)
          return
        }

        // Fetch all snapshots (incremental optimization based on current displayed projects)
        const currentMap = new Map(projects.map(p => [p.id, p]))
        const staleIds = projectRows
          .filter(p => {
            const cached = currentMap.get(p.id)
            return !cached || cached.updated_at !== p.updated_at
          })
          .map(p => p.id)

        const staleSet = new Set(staleIds)
        const snapshotMap = new Map<string, { id: string; image_url: string; sort_order: number }[]>()
        for (const [id, p] of currentMap) {
          if (!staleSet.has(id)) snapshotMap.set(id, p.snapshots)
        }

        if (staleIds.length > 0) {
          const { data: snapshotRows, error: sErr } = await supabase
            .from('snapshots')
            .select('id, project_id, image_url, sort_order')
            .in('project_id', staleIds)
            .order('sort_order', { ascending: true })
          if (sErr) console.error('Failed to fetch snapshots:', sErr)
          for (const s of snapshotRows ?? []) {
            const list = snapshotMap.get(s.project_id) ?? []
            list.push({ id: s.id, image_url: s.image_url, sort_order: s.sort_order })
            snapshotMap.set(s.project_id, list)
          }
        }

        if (cancelled) return

        // Fetch which projects have completed videos
        const projectIds = projectRows.map(p => p.id)
        const videoProjectIds = new Set<string>()
        if (projectIds.length > 0) {
          const { data: animRows } = await supabase
            .from('project_animations')
            .select('project_id')
            .in('project_id', projectIds)
            .eq('status', 'completed')
          if (animRows) {
            for (const row of animRows) videoProjectIds.add(row.project_id)
          }
        }

        if (cancelled) return

        const result: ProjectWithSnapshots[] = projectRows
          .map((p) => ({ ...p, snapshots: snapshotMap.get(p.id) ?? [], hasVideo: videoProjectIds.has(p.id) }))
          .filter((p) => p.snapshots.length > 0)

        // Patch missing image_urls from IndexedDB cache (upload may not have completed)
        const missingKeys = result.flatMap(p =>
          p.snapshots.filter(s => !s.image_url).map(s => `snap:${s.id}`)
        )
        let displayResult = result
        if (missingKeys.length > 0) {
          const cacheMap = await getCachedImages(missingKeys)
          if (cacheMap.size > 0) {
            displayResult = result.map(p => ({
              ...p,
              snapshots: p.snapshots.map(s => {
                const cached = !s.image_url ? cacheMap.get(`snap:${s.id}`) : undefined
                return cached ? { ...s, image_url: cached } : s
              }),
            }))
          }
        }

        if (cancelled) return
        // Cache clean Supabase data (with URLs, no base64)
        cacheProjectsList(user!.id, result)
        shownRef.current = true
        setProjects(displayResult)
        setLoadingProjects(false)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch projects:', err)
        // Offline: if cache already showed data, stay on it
        if (!shownRef.current) setLoadingProjects(false)
      }
    }

    fetchProjects()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleCreateProject = useCallback(async (files: File[]) => {
    if (!user || creating || files.length === 0) return
    setCreating(true)

    try {
      // Extract EXIF metadata from first file only
      let metadata: { takenAt?: string; location?: string } | undefined
      try {
        const exifr = (await import('exifr')).default
        const exif = await exifr.parse(files[0], { gps: true, reviveValues: false })
        console.log('[EXIF]', JSON.stringify({ lat: exif?.latitude, lng: exif?.longitude, date: exif?.DateTimeOriginal }))
        if (exif) {
          const lat = exif.latitude; const lng = exif.longitude
          const datetimeRaw: string | undefined = exif.DateTimeOriginal || exif.CreateDate
          let takenAt: string | undefined
          if (datetimeRaw && typeof datetimeRaw === 'string') {
            const m = datetimeRaw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
            if (m) {
              const utcOffset = lat !== undefined && lng !== undefined
                ? Math.round(lng / 15)
                : undefined
              const tzStr = utcOffset !== undefined
                ? ` (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset})`
                : ''
              takenAt = `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日 ${m[4]}:${m[5]}${tzStr}`
            }
          }
          let location: string | undefined
          if (lat && lng) {
            try {
              const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`, { headers: { 'User-Agent': 'Makaron-App/1.0' } })
              if (geoRes.ok) {
                const geo = await geoRes.json()
                const addr = geo.address
                const city = addr.city || addr.town || addr.village || addr.county
                location = [city, addr.country].filter(Boolean).join(', ')
                console.log('[GEOCODE]', location, '| addr:', JSON.stringify(addr))
              } else {
                console.log('[GEOCODE] failed:', geoRes.status)
              }
            } catch (e) { console.log('[GEOCODE] error:', e) }
          }
          if (takenAt || location) metadata = { takenAt, location }
          console.log('[METADATA]', JSON.stringify(metadata))
        }
      } catch { /* EXIF reading is non-critical */ }

      // Parallel compress all files
      const base64Array = await Promise.all(files.map(async (file) => {
        try {
          const decodable = await ensureDecodableFile(file)
          return await compressClientSide(decodable)
        } catch {
          console.warn('[HEIC] client conversion failed, trying server fallback')
          const formData = new FormData()
          formData.append('file', file)
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
          if (!uploadRes.ok) throw new Error('Server HEIC conversion failed')
          const { image } = await uploadRes.json()
          return image as string
        }
      }))

      const supabase = createClient()
      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ user_id: user.id, title: 'Untitled' })
        .select('id')
        .single()

      if (pErr || !project) throw new Error('Failed to create project')
      sessionStorage.setItem('pendingImages', JSON.stringify(base64Array))
      if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
      router.push(`/projects/${project.id}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router])

  // Unified create: text only, image only, or both
  const handleCreate = useCallback(async () => {
    const hasText = inputText.trim()
    const hasFiles = attachedFiles.length > 0
    if (!hasText && !hasFiles) return
    if (!user || creating) return

    // Image-only (no text) → original flow
    if (hasFiles && !hasText) {
      handleCreateProject(attachedFiles)
      return
    }

    setCreating(true)
    try {
      const base64Array: string[] = []
      if (hasFiles) {
        for (const file of attachedFiles) {
          try {
            const decodable = await ensureDecodableFile(file)
            base64Array.push(await compressClientSide(decodable))
          } catch {
            console.warn('[HEIC] client conversion failed, trying server fallback')
            const formData = new FormData()
            formData.append('file', file)
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
            if (!uploadRes.ok) throw new Error('Server HEIC conversion failed')
            const { image } = await uploadRes.json()
            base64Array.push(image)
          }
        }
      }

      const supabase = createClient()
      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ user_id: user.id, title: 'Untitled' })
        .select('id')
        .single()
      if (pErr || !project) throw new Error('Failed to create project')

      if (base64Array.length > 0) sessionStorage.setItem('pendingImages', JSON.stringify(base64Array))
      sessionStorage.setItem('pendingPrompt', hasText)
      setInputText('')
      setAttachedFiles([])
      setAttachedPreviews([])
      router.push(`/projects/${project.id}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router, inputText, attachedFiles, handleCreateProject])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (creating) return
    const droppedFiles = Array.from(e.dataTransfer.files ?? []).filter(
      f => f.type.startsWith('image/') || isHeicFile(f)
    )
    addFiles(droppedFiles)
  }, [creating, addFiles])

  if (authLoading || !user) {
    return (
      <div style={{ height: '100dvh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');
        .mkr-page { font-family: inherit; }
        .mkr-handwrite { font-family: 'Caveat', cursive; }

        @keyframes mkr-in {
          from { transform: translateY(12px); }
          to   { transform: translateY(0); }
        }
        .mkr-row-enter { animation: mkr-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }

        .mkr-card {
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
        }
        .mkr-card img {
          transition: transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: center;
        }
        .mkr-card:active img,
        .mkr-card:active .mkr-card-img { transform: scale(0.96); }

        .mkr-new-btn {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.18s, opacity 0.15s;
          user-select: none;
          -webkit-user-select: none;
        }
        .mkr-new-btn:hover {
          border-color: rgba(217,70,239,0.6) !important;
          box-shadow: 0 0 32px rgba(217,70,239,0.2);
        }
        .mkr-new-btn:active { transform: scale(0.96); opacity: 0.8; }

        .mkr-input-box {
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .mkr-input-box:focus-within {
          border-color: rgba(217,70,239,0.35) !important;
          box-shadow: 0 0 0 1px rgba(217,70,239,0.12);
        }

        .mkr-create-btn {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          transition: background 0.2s, border-color 0.2s, transform 0.15s, box-shadow 0.2s;
        }
        .mkr-create-btn:hover {
          background: rgba(217,70,239,0.1) !important;
          border-color: rgba(217,70,239,0.5) !important;
          box-shadow: 0 0 20px rgba(217,70,239,0.15);
        }
        .mkr-create-btn:active { transform: scale(0.96); }

        @keyframes mkr-spin { to { transform: rotate(360deg); } }
        .mkr-spin { animation: mkr-spin 0.9s linear infinite; }

        .mkr-more-btn {
          transition: background 0.15s, opacity 0.15s;
        }
        .mkr-more-btn:hover { opacity: 1 !important; }
        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div className={`mkr-page${navigating ? ' page-slide-out' : ''}`} style={{ minHeight: '100dvh', background: '#000', color: '#fff', overflowX: 'hidden' }}>

        {/* Ambient glow — center at 40% so top is black, fades to purple below */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          height: '520px', pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(217,70,239,0.22) 0%, transparent 65%)',
        }} />

        <input
          id="new-project-file-input"
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            addFiles(files)
          }}
        />

        {/* Top bar: language toggle (left) + sign out (right) */}
        <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 10 }}>
          <LocaleToggle />
          <button
            onClick={() => signOut()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.18)',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.18)')}
          >
            Sign out
          </button>
        </div>

        {/* ═══════════════════════════════
            HERO — ~45dvh, fully centered
        ════════════════════════════════ */}
        <div style={{
          paddingTop: '20vh', paddingBottom: '40px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '0px',
          position: 'relative', zIndex: 1,
        }}>
          {/* Wordmark row: asterisk icon + Makaron */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            {/* Asterisk / sparkle SVG */}
            <svg
              width="20" height="20" viewBox="0 0 24 24"
              fill="none"
              stroke="rgb(217,70,239)"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </svg>

            {/* Wordmark */}
            <div style={{
              fontWeight: 800,
              fontSize: 'clamp(3rem, 12vw, 5rem)',
              letterSpacing: '-0.04em',
              color: '#fff',
              lineHeight: 1,
            }}>
              Makaron
            </div>
          </div>

          {/* Subtitle */}
          <div style={{ marginTop: '4px' }}>
            <RollingTagline className="text-[1.25rem] tracking-wide" />
          </div>

          {/* Create input: [photo] + [textarea] */}
          <div style={{ marginTop: '32px', width: '100%', padding: '0 16px', maxWidth: '480px' }}>
            <div
              ref={inputBoxRef}
              className="mkr-input-box"
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
              style={{
                display: 'flex', gap: 0,
                borderRadius: 18,
                border: dragOver ? '1px solid rgba(217,70,239,0.6)' : '1px solid rgba(255,255,255,0.1)',
                background: dragOver ? 'rgba(217,70,239,0.08)' : 'rgba(255,255,255,0.03)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, background 0.2s',
              }}
            >
              {/* Left: photo slot — square, width = container height */}
              <div
                onClick={(e) => {
                  if (creating) return
                  fileInputRef.current?.click()
                }}
                style={{
                  width: photoSlotWidth, flexShrink: 0, alignSelf: 'stretch',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: creating ? 'default' : 'pointer',
                  borderRight: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  background: attachedFiles.length > 0 ? 'transparent' : 'rgba(217,70,239,0.04)',
                }}
              >
                {attachedFiles.length === 0 ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                ) : attachedFiles.length === 1 ? (
                  <>
                    {attachedPreviews[0] && attachedPreviews[0] !== 'heic-pending' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachedPreviews[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : attachedPreviews[0] === null ? (
                      <Spinner size={16} />
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.7)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
                    )}
                    <div style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 2 }}
                      onClick={(e) => { e.stopPropagation(); setAttachedFiles([]); setAttachedPreviews([]);  }}>✕</div>
                  </>
                ) : (
                  /* Stacked cards effect for 2+ images */
                  <>
                    {/* Card stack container — inset 6px from edges */}
                    <div style={{ position: 'absolute', inset: 6, pointerEvents: 'none' }}>
                      {(() => {
                        // Show up to 3 layers: back, middle (if 3+), front
                        const cardStyle = (preview: string | null, rotate: number, zIndex: number): React.CSSProperties => ({
                          position: 'absolute', inset: 0,
                          borderRadius: 6, overflow: 'hidden',
                          transform: `rotate(${rotate}deg)`,
                          border: '1.5px solid rgba(255,255,255,0.12)',
                          background: '#1a1a1a',
                          zIndex,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                        })
                        const n = attachedFiles.length
                        const layers: { preview: string | null; rotate: number; z: number }[] = []
                        if (n >= 3) layers.push({ preview: attachedPreviews[0], rotate: -6, z: 1 })
                        if (n >= 2) layers.push({ preview: attachedPreviews[n >= 3 ? 1 : 0], rotate: n >= 3 ? 4 : -5, z: 2 })
                        layers.push({ preview: attachedPreviews[n - 1], rotate: 0, z: 3 })
                        return layers.map((layer, i) => (
                          <div key={i} style={cardStyle(layer.preview, layer.rotate, layer.z)}>
                            {layer.preview && layer.preview !== 'heic-pending' ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : layer.preview === null ? (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Spinner size={12} />
                              </div>
                            ) : null}
                          </div>
                        ))
                      })()}
                    </div>
                    {/* Count badge */}
                    <div style={{
                      position: 'absolute', bottom: 4, right: 4, zIndex: 4,
                      background: 'rgba(217,70,239,0.85)', color: '#fff',
                      borderRadius: 8, padding: '1px 6px',
                      fontSize: '0.6rem', fontWeight: 700,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    }}>
                      {attachedFiles.length}
                    </div>
                    {/* Clear button */}
                    <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 5 }}
                      onClick={(e) => { e.stopPropagation(); setAttachedFiles([]); setAttachedPreviews([]);  }}>✕</div>
                  </>
                )}
              </div>

              {/* Right: textarea + bottom toolbar */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inputText.trim() || attachedFiles.length > 0)) {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={"Got a pic? Let's glow it up.\nNo pic? I'll cook one up."}
                  disabled={creating}
                  rows={3}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    color: '#fff', fontSize: '0.95rem', lineHeight: 1.45,
                    padding: '12px 14px 4px',
                    outline: 'none', resize: 'none',
                    fontFamily: 'var(--font-geist-sans), sans-serif',
                    minHeight: 60,
                  }}
                />
                {/* Bottom toolbar: [thumbnails (scrollable)] [Create (pinned)] */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px 8px',
                }}>
                  {/* Scrollable thumbnails area */}
                  <div
                    className="hide-scrollbar"
                    onWheel={(e) => {
                      if (e.deltaY !== 0) {
                        e.currentTarget.scrollLeft += e.deltaY
                        e.preventDefault()
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      flex: 1, minWidth: 0,
                      overflowX: 'auto',
                      paddingTop: 4,
                    }}
                  >
                  {attachedPreviews.map((preview, i) => (
                    <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                      {preview && preview !== 'heic-pending' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview} alt="" style={{
                          width: 36, height: 36, borderRadius: 8,
                          objectFit: 'cover', display: 'block',
                          border: '1px solid rgba(255,255,255,0.12)',
                        }} />
                      ) : (
                        <div style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Spinner size={10} />
                        </div>
                      )}
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          setAttachedFiles(prev => prev.filter((_, j) => j !== i))
                          setAttachedPreviews(prev => prev.filter((_, j) => j !== i))
                        }}
                        style={{
                          position: 'absolute', top: -4, right: -4,
                          width: 14, height: 14, borderRadius: '50%',
                          background: 'rgba(20,20,20,0.9)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </div>
                    </div>
                  ))}

                  </div>

                  {/* Create button */}
                  <button
                    className="mkr-create-btn"
                    onClick={() => {
                      if (inputText.trim() || attachedFiles.length > 0) handleCreate()
                      else fileInputRef.current?.click()
                    }}
                    disabled={creating}
                    style={{
                      flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '14px',
                      background: 'none',
                      border: 'none',
                      color: 'rgba(217,70,239,0.9)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      letterSpacing: '0.03em',
                      cursor: creating ? 'default' : 'pointer',
                      fontFamily: 'var(--font-geist-sans), sans-serif',
                    }}
                  >
                    {creating ? <Spinner size={12} /> : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ═══════════════════════════════
            GALLERY SECTION
        ════════════════════════════════ */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: '8px', maxWidth: isDesktop ? '1232px' : undefined, margin: isDesktop ? '8px auto 0' : undefined }}>

          {/* Section divider — only show when projects exist */}
          {!loadingProjects && projects.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '0 16px', marginBottom: '14px',
            }}>
              <span style={{
                fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.18)', fontWeight: 400, flexShrink: 0,
              }}>
                Recents
              </span>
              <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.07)' }} />
            </div>
          )}

          {loadingProjects ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <Spinner size={20} />
            </div>
          ) : projects.length === 0 ? (
            <p style={{
              textAlign: 'center', padding: '40px 0 80px', margin: 0,
              color: 'rgba(255,255,255,0.2)', fontSize: '0.82rem', letterSpacing: '0.04em',
            }}>
              No projects yet
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(2, 1fr)',
              gap: isDesktop ? '14px' : '10px',
              padding: '0 16px 80px',
              maxWidth: isDesktop ? '1200px' : undefined,
              margin: isDesktop ? '0 auto' : undefined,
            }}>
              {projects.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  index={i}
                  onMore={(e) => openActionSheet(e, project)}
                  onNavigate={() => setNavigating(true)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Action Sheet ── */}
      {actionSheet && (
        <div
          onClick={() => setActionSheet(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '480px', margin: '0 auto',
              background: '#141414', borderRadius: '20px 20px 0 0',
              padding: '12px 16px 32px',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Handle */}
            <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }} />

            {/* Project name */}
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textAlign: 'center', marginBottom: '16px' }}>
              {actionSheet.title}
            </div>

            {renameMode ? (
              /* Rename input */
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleRename(); if (e.key === 'Escape') setRenameMode(false); }}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '10px', padding: '12px 14px', color: '#fff', fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleRename}
                  style={{
                    background: 'rgba(217,70,239,0.2)', border: '1px solid rgba(217,70,239,0.3)',
                    borderRadius: '10px', color: 'rgba(217,70,239,0.9)', padding: '0 18px',
                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                  }}
                >
                  {t('project.save')}
                </button>
              </div>
            ) : (
              <>
                {/* Rename button */}
                <button
                  onClick={() => setRenameMode(true)}
                  style={{
                    width: '100%', padding: '16px', background: 'rgba(255,255,255,0.04)',
                    border: 'none', borderRadius: '12px', color: 'rgba(255,255,255,0.8)',
                    cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  {t('project.rename')}
                </button>

                {/* Delete button */}
                <button
                  onClick={handleDelete}
                  style={{
                    width: '100%', padding: '16px', background: 'rgba(239,68,68,0.08)',
                    border: 'none', borderRadius: '12px', color: 'rgba(239,68,68,0.85)',
                    cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,6 5,6 21,6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  {t('project.delete')}
                </button>
              </>
            )}

            {/* Cancel */}
            <button
              onClick={() => setActionSheet(null)}
              style={{
                width: '100%', padding: '14px', background: 'none',
                border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
                fontSize: '0.85rem', marginTop: '4px',
              }}
            >
              {t('project.cancel')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function ProjectCard({
  project,
  index,
  onMore,
  onNavigate,
}: {
  project: ProjectWithSnapshots
  index: number
  onMore: (e: React.MouseEvent) => void
  onNavigate: () => void
}) {
  const lastSnap = project.snapshots[project.snapshots.length - 1]
  const [loaded, setLoaded] = useState(false)

  return (
    <Link
      href={`/projects/${project.id}`}
      prefetch={false}
      className="mkr-card mkr-row-enter"
      onClick={onNavigate}
      style={{
        display: 'block',
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: '16px',
        overflow: 'hidden',
        background: '#120d1a',
        animationDelay: `${index * 0.06}s`,
        textDecoration: 'none',
      }}
    >
      {/* Placeholder shimmer while image loads */}
      {!loaded && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #120d1a 0%, #1c1026 50%, #120d1a 100%)',
        }} />
      )}

      {/* Full-bleed photo — use Supabase transform for smaller thumbnails */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getThumbnailUrl(lastSnap.image_url, 400, 50, 400)}
        alt={project.title}
        fetchPriority={index < 4 ? 'high' : undefined}
        style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          display: 'block',
          pointerEvents: 'none',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onLoad={() => setLoaded(true)}
      />

      {/* Bottom gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
        pointerEvents: 'none',
      }} />

      {/* Overlaid text — bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '10px 10px 11px',
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '6px',
        }}>
          <div style={{
            fontSize: '0.82rem', fontWeight: 500, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3, flex: 1, minWidth: 0,
          }}>
            {project.title}
          </div>
          <div style={{
            fontSize: '0.62rem',
            color: 'rgba(255,255,255,0.45)',
            flexShrink: 0,
          }}>
            {timeAgo(project.updated_at)}
          </div>
        </div>
        {/* Badges row */}
        {(project.snapshots.length > 1 || project.hasVideo) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            marginTop: '5px',
          }}>
            {project.snapshots.length > 1 && (
              <span style={{
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '0.68rem',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.8)',
              }}>
                {project.snapshots.length} snaps
              </span>
            )}
            {project.hasVideo && (
              <span style={{
                background: 'rgba(217,70,239,0.4)',
                backdropFilter: 'blur(4px)',
                borderRadius: '6px',
                padding: '2px 6px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="white">
                  <polygon points="3,1.5 8.5,5 3,8.5" />
                </svg>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top-right more button */}
      <button
        className="mkr-more-btn"
        onClick={(e) => { e.preventDefault(); onMore(e) }}
        style={{
          position: 'absolute', top: '8px', right: '8px',
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          border: 'none',
          borderRadius: '8px',
          color: 'rgba(255,255,255,0.75)',
          width: '28px', height: '28px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
          opacity: 0.85,
          letterSpacing: '0.02em',
        }}
        aria-label="More options"
      >
        ···
      </button>
    </Link>
  )
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="mkr-spin" width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="rgba(217,70,239,0.12)" strokeWidth="2.5" fill="none" />
      <path fill="rgba(217,70,239,0.7)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
