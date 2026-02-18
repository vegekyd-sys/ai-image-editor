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

function compressClientSide(file: File, maxSize = 1024, quality = 0.85): Promise<string> {
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
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return `${months} 个月前`
}

export default function ProjectsPage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectWithSnapshots[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [user, authLoading, router])

  // Fetch projects + snapshots
  useEffect(() => {
    if (!user) return

    const supabase = createClient()

    async function fetchProjects() {
      const { data: projectRows, error: pErr } = await supabase
        .from('projects')
        .select('id, title, cover_url, updated_at, created_at')
        .eq('user_id', user!.id)
        .order('updated_at', { ascending: false })

      if (pErr || !projectRows) {
        console.error('Failed to fetch projects:', pErr)
        setLoadingProjects(false)
        return
      }

      if (projectRows.length === 0) {
        setProjects([])
        setLoadingProjects(false)
        return
      }

      // Fetch snapshots for all projects
      const projectIds = projectRows.map((p) => p.id)
      const { data: snapshotRows, error: sErr } = await supabase
        .from('snapshots')
        .select('id, project_id, image_url, sort_order')
        .in('project_id', projectIds)
        .order('sort_order', { ascending: true })

      if (sErr) {
        console.error('Failed to fetch snapshots:', sErr)
      }

      // Group snapshots by project
      const snapshotMap = new Map<string, { id: string; image_url: string; sort_order: number }[]>()
      for (const s of snapshotRows ?? []) {
        const list = snapshotMap.get(s.project_id) ?? []
        list.push({ id: s.id, image_url: s.image_url, sort_order: s.sort_order })
        snapshotMap.set(s.project_id, list)
      }

      // Filter out empty projects (no snapshots = never used)
      const result: ProjectWithSnapshots[] = projectRows
        .map((p) => ({
          ...p,
          snapshots: snapshotMap.get(p.id) ?? [],
        }))
        .filter((p) => p.snapshots.length > 0)

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
        // Fallback to server-side conversion (HEIC etc.)
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Image conversion failed')
        base64 = (await res.json()).image
      }

      const supabase = createClient()

      // Create project (no snapshot yet — editor will handle the full upload flow)
      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ user_id: user.id, title: '未命名项目' })
        .select('id')
        .single()

      if (pErr || !project) throw new Error('Failed to create project')

      // Store image in sessionStorage for the editor to pick up
      sessionStorage.setItem('pendingImage', base64)

      router.push(`/projects/${project.id}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router])

  if (authLoading || !user) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleCreateProject(file)
          e.target.value = ''
        }}
      />

      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold">我的项目</h1>
        <button
          onClick={() => signOut()}
          className="text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          退出登录
        </button>
      </div>

      {/* New project upload area */}
      <div className="px-4 pb-4">
        <button
          onClick={() => !creating && fileInputRef.current?.click()}
          disabled={creating}
          className="w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-white/10 hover:border-fuchsia-500/40 transition-colors flex flex-col items-center justify-center gap-3 bg-surface/50 disabled:opacity-50"
        >
          {creating ? (
            <>
              <svg className="animate-spin h-8 w-8 text-fuchsia-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-white/40">创建中...</span>
            </>
          ) : (
            <>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-white/50">上传照片开始新项目</p>
                <p className="text-xs text-white/25 mt-1">点击选择图片</p>
              </div>
            </>
          )}
        </button>
      </div>

      {/* Project list */}
      <div className="px-4 pb-8">
        {loadingProjects ? (
          <div className="flex justify-center py-12">
            <svg className="animate-spin h-5 w-5 text-white/20" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-white/20 text-sm">
            还没有项目，上传一张照片开始吧
          </div>
        ) : (
          <div className="space-y-5">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onClick={() => router.push(`/projects/${project.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  onClick,
}: {
  project: ProjectWithSnapshots
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left group"
    >
      {/* Title + time */}
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-white/80 group-hover:text-white transition-colors truncate mr-2">
          {project.title}
        </h3>
        <span className="text-xs text-white/25 flex-shrink-0">
          {timeAgo(project.updated_at)}
        </span>
      </div>

      {/* Snapshot thumbnails — horizontal scroll */}
      <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
        {project.snapshots.map((snap) => (
          <div
            key={snap.id}
            className="flex-shrink-0 w-[72px] h-[72px] rounded-lg overflow-hidden bg-surface-secondary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={snap.image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </button>
  )
}
