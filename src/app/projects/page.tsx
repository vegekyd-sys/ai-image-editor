'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ProjectWithSnapshots {
  id: string
  title: string
  cover_url: string | null
  updated_at: string
  created_at: string
  snapshots: { id: string; image_url: string; sort_order: number }[]
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

// Module-level cache — survives navigation, cleared on explicit refresh
let _projectsCache: ProjectWithSnapshots[] | null = null

export function invalidateProjectsCache() {
  _projectsCache = null
}

export default function ProjectsPage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectWithSnapshots[]>(_projectsCache ?? [])
  const [loadingProjects, setLoadingProjects] = useState(_projectsCache === null)
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [actionSheet, setActionSheet] = useState<ProjectWithSnapshots | null>(null)

  const [renameValue, setRenameValue] = useState('')
  const [renameMode, setRenameMode] = useState(false)

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

  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    const hasCache = _projectsCache !== null

    async function fetchProjects() {
      const { data: projectRows, error: pErr } = await supabase
        .from('projects')
        .select('id, title, cover_url, updated_at, created_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })

      if (pErr || !projectRows) {
        console.error('Failed to fetch projects:', pErr)
        if (!hasCache) setLoadingProjects(false)
        return
      }

      if (projectRows.length === 0) {
        _projectsCache = []
        setProjects([])
        setLoadingProjects(false)
        return
      }

      // Incremental: only fetch snapshots for projects whose updated_at changed
      const cachedMap = new Map(_projectsCache?.map(p => [p.id, p]) ?? [])
      const staleIds = projectRows
        .filter(p => {
          const cached = cachedMap.get(p.id)
          return !cached || cached.updated_at !== p.updated_at
        })
        .map(p => p.id)

      const staleSet = new Set(staleIds)
      const snapshotMap = new Map<string, { id: string; image_url: string; sort_order: number }[]>()
      // Carry over cached snapshots only for unchanged projects
      for (const [id, p] of cachedMap) {
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

      const result: ProjectWithSnapshots[] = projectRows
        .map((p) => ({ ...p, snapshots: snapshotMap.get(p.id) ?? [] }))
        .filter((p) => p.snapshots.length > 0)

      _projectsCache = result
      setProjects(result)
      setLoadingProjects(false)
    }

    fetchProjects()
  }, [user])

  const handleCreateProject = useCallback(async (file: File) => {
    if (!user || creating) return
    setCreating(true)

    try {
      let base64: string
      try {
        base64 = await compressClientSide(file)
      } catch {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Image conversion failed')
        base64 = (await res.json()).image
      }

      const supabase = createClient()
      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ user_id: user.id, title: 'Untitled' })
        .select('id')
        .single()

      if (pErr || !project) throw new Error('Failed to create project')
      sessionStorage.setItem('pendingImage', base64)
      router.push(`/projects/${project.id}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router])

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
        .mkr-page { font-family: inherit; }

        @keyframes mkr-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .mkr-row-enter { animation: mkr-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; }

        .mkr-row { transition: background 0.2s; cursor: pointer; }
        .mkr-row:hover  { background: rgba(255,255,255,0.025); }
        .mkr-row:active { background: rgba(255,255,255,0.045); }

        .mkr-plus-btn {
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.18s;
        }
        .mkr-plus-btn:hover {
          border-color: rgba(217,70,239,0.55) !important;
          box-shadow: 0 0 24px rgba(217,70,239,0.18);
        }
        .mkr-plus-btn:active { transform: scale(0.94); }

        .mkr-snap-strip { -ms-overflow-style: none; scrollbar-width: none; }
        .mkr-snap-strip::-webkit-scrollbar { display: none; }

        @keyframes mkr-spin { to { transform: rotate(360deg); } }
        .mkr-spin { animation: mkr-spin 0.9s linear infinite; }
      `}</style>

      <div className="mkr-page" style={{ minHeight: '100dvh', background: '#080808', color: '#fff', overflowX: 'hidden' }}>

        {/* Ambient glow */}
        <div style={{
          position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '500px', height: '340px', pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(217,70,239,0.07) 0%, transparent 70%)',
        }} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleCreateProject(file)
            e.target.value = ''
          }}
        />

        {/* ── Sign out (absolute top-right) ── */}
        <button
          onClick={() => signOut()}
          style={{
            position: 'fixed', top: '20px', right: '20px', zIndex: 10,
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

        {/* ═══════════════════════════════
            HERO — 60dvh, fully centered
        ════════════════════════════════ */}
        <div style={{
          height: '60dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '6px',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{
            fontWeight: 200, fontSize: '2rem', letterSpacing: '0.01em',
            color: '#fff', lineHeight: 1,
          }}>
            Makaron
          </div>
          <div style={{
            fontSize: '0.6rem', letterSpacing: '0.18em',
            color: 'rgba(217,70,239,0.5)', fontWeight: 300, textTransform: 'uppercase',
          }}>
            AI Photo Studio
          </div>

          {/* + button */}
          <div style={{ marginTop: '28px' }}>
            {creating ? (
              <Spinner size={24} />
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mkr-plus-btn"
                style={{
                  width: '60px', height: '60px', borderRadius: '14px',
                  background: 'transparent',
                  border: '1.5px solid rgba(217,70,239,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'rgba(217,70,239,0.7)',
                  fontSize: '2rem', fontWeight: 200, lineHeight: 1,
                  paddingBottom: '2px',
                }}
              >
                +
              </button>
            )}
            <p style={{
              margin: '10px 0 0', textAlign: 'center',
              fontSize: '0.68rem', color: 'rgba(255,255,255,0.22)',
              letterSpacing: '0.04em',
            }}>
              {creating ? 'Creating…' : 'New project'}
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════
            PROJECT LIST
        ════════════════════════════════ */}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '480px', margin: '0 auto', padding: '0 20px' }}>

          {/* Section label */}
          {!loadingProjects && projects.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{
                fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.18)', fontWeight: 300, flexShrink: 0,
              }}>
                Recent
              </span>
              <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          )}

          {loadingProjects ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Spinner size={16} />
            </div>
          ) : projects.length === 0 ? (
            <p style={{
              textAlign: 'center', padding: '24px 0 48px', margin: 0,
              color: 'rgba(255,255,255,0.14)', fontSize: '0.78rem', letterSpacing: '0.04em',
            }}>
              No projects yet
            </p>
          ) : (
            <div style={{ paddingBottom: '52px' }}>
              {projects.map((project, i) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  index={i}
                  onClick={() => router.push(`/projects/${project.id}`)}
                  onMore={(e) => openActionSheet(e, project)}
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
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenameMode(false); }}
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
                  保存
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
                  重命名
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
                  删除项目
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
              取消
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function ProjectRow({
  project,
  index,
  onClick,
  onMore,
}: {
  project: ProjectWithSnapshots
  index: number
  onClick: () => void
  onMore: (e: React.MouseEvent) => void
}) {
  const total = project.snapshots.length

  return (
    <div
      className="mkr-row mkr-row-enter"
      style={{
        textAlign: 'left', background: 'none',
        padding: '16px 12px', borderRadius: '14px', display: 'block',
        animationDelay: `${index * 0.05}s`,
        marginLeft: '-12px', width: 'calc(100% + 24px)',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      {/* Title + time + more button */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <span style={{
          fontSize: '0.82rem', fontWeight: 400, color: 'rgba(255,255,255,0.72)',
          letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', marginRight: '8px', flex: 1,
        }}>
          {project.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.22)', letterSpacing: '0.04em' }}>
            {timeAgo(project.updated_at)}
          </span>
          <button
            onClick={onMore}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
              color: 'rgba(255,255,255,0.2)', fontSize: '1rem', lineHeight: 1,
              borderRadius: '6px', transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
          >
            ···
          </button>
        </div>
      </div>

      {/* Filmstrip: thumbnails connected by a timeline rail */}
      <div style={{ position: 'relative' }}>
        {/* Timeline rail — sits at vertical center of thumbnails */}
        <div style={{
          position: 'absolute',
          top: '50px', /* half of 100px thumb height */
          left: '6px', right: '6px', height: '1px',
          background: 'rgba(255,255,255,0.06)',
          zIndex: 0,
        }} />

        <div
          className="mkr-snap-strip"
          style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', overflowX: 'auto', position: 'relative', zIndex: 1 }}
        >
          {project.snapshots.map((snap, si) => (
            <FilmFrame
              key={snap.id}
              url={snap.image_url}
              step={si + 1}
              total={total}
              isLast={si === total - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FilmFrame({
  url,
  step,
  total,
  isLast,
}: {
  url: string
  step: number
  total: number
  isLast: boolean
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ flexShrink: 0, textAlign: 'center' }}>
      {/* Thumbnail */}
      <div style={{
        position: 'relative',
        width: '100px', height: '100px',
        borderRadius: '10px', overflow: 'hidden',
        border: isLast
          ? '1.5px solid rgba(217,70,239,0.5)'
          : '1.5px solid rgba(255,255,255,0.08)',
        background: '#161616',
      }}>
        {!loaded && (
          <div style={{ position: 'absolute', inset: 0, background: '#1a1a1a' }} />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            opacity: loaded ? 1 : 0, transition: 'opacity 0.25s',
          }}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
      </div>

      {/* Step label */}
      <div style={{
        marginTop: '5px',
        fontSize: '0.58rem',
        letterSpacing: '0.06em',
        color: isLast ? 'rgba(217,70,239,0.65)' : 'rgba(255,255,255,0.2)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {isLast ? `v${step}` : String(step).padStart(2, '0')}
      </div>
    </div>
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
