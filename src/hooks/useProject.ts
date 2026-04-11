'use client'

import { useRef, useCallback } from 'react'
import { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { uploadImage } from '@/lib/supabase/storage'
import { Snapshot, Message, Tip, DbSnapshot, DbMessage, ProjectAnimation } from '@/types'

interface LoadedProject {
  snapshots: Snapshot[]
  messages: Message[]
  title: string
  animations: ProjectAnimation[]
}

const MAX_UPLOAD_ATTEMPTS = 3

export function useProject(projectId: string, userId: string) {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const uploadAttemptsRef = useRef<Map<string, number>>(new Map())

  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  // --- Load ---

  const loadProject = useCallback(async (): Promise<LoadedProject> => {
    const supabase = getSupabase()

    const [snapshotsRes, messagesRes, projectRes, animationRes] = await Promise.all([
      supabase
        .from('snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('messages')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
      supabase
        .from('projects')
        .select('title')
        .eq('id', projectId)
        .single(),
      supabase
        .from('project_animations')
        .select('id, video_url, prompt, snapshot_urls, status, piapi_task_id, created_at')
        .eq('project_id', projectId)
        .in('status', ['completed', 'processing'])
        .order('created_at', { ascending: false }),
    ])

    const dbSnapshots: DbSnapshot[] = snapshotsRes.data ?? []
    const dbMessages: DbMessage[] = messagesRes.data ?? []

    const snapshots: Snapshot[] = dbSnapshots.map((s) => ({
      id: s.id,
      image: s.image_url, // Use Storage URL as the image source
      tips: (Array.isArray(s.tips) ? s.tips : []).map(t => ({
        ...t,
        previewStatus: t.previewImage ? 'done' as const
          : t.editPrompt ? 'error' as const : undefined,
      })),
      messageId: s.message_id || '',
      imageUrl: s.image_url,
      description: s.description ?? undefined,
      ...(s.type ? { type: s.type as Snapshot['type'] } : {}),
      ...(s.design_path ? { _designPath: s.design_path } : {}),
    }))

    // Load persisted designs from workspace (async, non-blocking)
    // Derive userId from first snapshot's image_url if userId param is empty (race condition on page load)
    const resolvedUserId = userId || (() => {
      // Extract userId (UUID) from any snapshot's image_url — skip non-user paths like /images/skills/
      const uuidRe = /\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//
      for (const s of dbSnapshots) {
        if (!s.image_url) continue
        const match = s.image_url.match(uuidRe)
        if (match) return match[1]
      }
      return ''
    })()
    for (const snap of snapshots) {
      const dp = (snap as any)._designPath as string | undefined
      if (!dp || !resolvedUserId) { delete (snap as any)._designPath; continue }
      try {
        const storagePath = `${resolvedUserId}/workspace/${dp}`
        const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath)
        if (urlData?.publicUrl) {
          const res = await Promise.race([
            fetch(urlData.publicUrl),
            new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ])
          if (res.ok) {
            const design = await res.json()
            snap.design = design
          }
        }
      } catch (e) {
        console.warn('Failed to load design from workspace:', dp, e)
      }
      delete (snap as any)._designPath
    }

    const messages: Message[] = dbMessages.map((m) => {
      // Restore inline image + design: find the snapshot linked to this message
      // Try by messageId first, then by has_image flag matching any snapshot with this message_id
      const linkedSnapshot = m.has_image
        ? snapshots.find(s => s.messageId === m.id)
        : undefined
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at).getTime(),
        projectId: m.project_id,
        ...(linkedSnapshot ? { image: linkedSnapshot.image } : {}),
        ...(linkedSnapshot?.design ? { design: linkedSnapshot.design } : {}),
      }
    })

    const animations: ProjectAnimation[] = (animationRes.data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      projectId,
      taskId: (row.piapi_task_id as string) ?? null,
      videoUrl: (row.video_url as string) ?? null,
      prompt: (row.prompt as string) ?? '',
      snapshotUrls: (row.snapshot_urls as string[]) ?? [],
      status: row.status as ProjectAnimation['status'],
      createdAt: row.created_at as string,
    }))

    return { snapshots, messages, title: projectRes.data?.title ?? 'Untitled', animations }
  }, [projectId])

  // --- Write (all fire-and-forget) ---

  const saveSnapshot = useCallback((snapshot: Snapshot, sortOrder: number, onUploaded?: (imageUrl: string) => void) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()

        let imageUrl: string | null

        // If image is already a Storage URL, skip upload
        if (snapshot.image.startsWith('http')) {
          imageUrl = snapshot.image
        } else {
          // Upload base64 image to Storage
          const filename = `snapshot-${snapshot.id}.jpg`
          imageUrl = await uploadImage(
            supabase,
            userId,
            projectId,
            filename,
            snapshot.image,
          )
        }

        if (!imageUrl) {
          console.warn('Failed to upload snapshot image')
          return
        }

        // Notify caller of the uploaded URL
        onUploaded?.(imageUrl)

        // Persist design code to workspace if present
        let designPath: string | null = null
        if (snapshot.design?.code) {
          designPath = `code/${snapshot.id}.json`
          const designJson = JSON.stringify({
            code: snapshot.design.code,
            width: snapshot.design.width,
            height: snapshot.design.height,
            animation: snapshot.design.animation,
            props: snapshot.design.props,
          })
          const bucket = supabase.storage.from('images')
          const storagePath = `${userId}/workspace/${designPath}`
          await bucket.upload(storagePath, new Blob([designJson], { type: 'application/json' }), { upsert: true })
        }

        // Upsert snapshot row (upsert handles React StrictMode double-invoke)
        const { error } = await supabase.from('snapshots').upsert({
          id: snapshot.id,
          project_id: projectId,
          image_url: imageUrl,
          tips: snapshot.tips,
          message_id: snapshot.messageId,
          sort_order: sortOrder,
          ...(snapshot.description ? { description: snapshot.description } : {}),
          ...(snapshot.type ? { type: snapshot.type } : {}),
          ...(designPath ? { design_path: designPath } : {}),
        }, { onConflict: 'id' })

        if (error) console.warn('saveSnapshot error:', error)
      } catch (err) {
        console.warn('saveSnapshot error:', err)
      }
    })
  }, [projectId, userId])

  const saveMessage = useCallback((message: Message) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()
        const { error } = await supabase.from('messages').upsert({
          id: message.id,
          project_id: projectId,
          role: message.role,
          content: message.content,
          has_image: !!message.image,
        }, { onConflict: 'id' })
        if (error) console.warn('saveMessage error:', error)
      } catch (err) {
        console.warn('saveMessage error:', err)
      }
    })
  }, [projectId])

  const updateTips = useCallback((snapshotId: string, tips: Tip[]) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()

        // Upload base64 preview images to Storage, replace with URLs
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const tipsForDb = await Promise.all(tips.map(async ({ previewStatus, ...rest }) => {

          // Already a Storage URL — keep it
          if (rest.previewImage && rest.previewImage.startsWith('http')) {
            return rest
          }

          // Base64 preview — upload to Storage
          if (rest.previewImage && rest.previewImage.startsWith('data:')) {
            const hash = Array.from(rest.editPrompt)
              .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
              .toString(36).replace('-', 'n')
            const filename = `preview-${snapshotId}-${hash}.jpg`

            // Skip if already failed too many times
            const attempts = uploadAttemptsRef.current.get(filename) ?? 0
            if (attempts >= MAX_UPLOAD_ATTEMPTS) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { previewImage, ...noPreview } = rest
              return noPreview
            }

            uploadAttemptsRef.current.set(filename, attempts + 1)
            const imageUrl = await uploadImage(supabase, userId, projectId, filename, rest.previewImage)
            if (imageUrl) {
              uploadAttemptsRef.current.delete(filename) // reset on success
              return { ...rest, previewImage: imageUrl }
            }
            // Upload failed — strip base64 (too large for jsonb)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { previewImage: _stripped, ...noPreview } = rest
            return noPreview
          }

          // No preview — save metadata only
          return rest
        }))

        const { error } = await supabase
          .from('snapshots')
          .update({ tips: tipsForDb })
          .eq('id', snapshotId)
        if (error) console.warn('updateTips error:', error)
      } catch (err) {
        console.warn('updateTips error:', err)
      }
    })
  }, [projectId, userId])

  const updateCover = useCallback((imageUrl: string) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()
        const { error } = await supabase
          .from('projects')
          .update({ cover_url: imageUrl, updated_at: new Date().toISOString() })
          .eq('id', projectId)
        if (error) console.warn('updateCover error:', error)
      } catch (err) {
        console.warn('updateCover error:', err)
      }
    })
  }, [projectId])

  const updateDescription = useCallback((snapshotId: string, description: string) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()
        const { error } = await supabase
          .from('snapshots')
          .update({ description })
          .eq('id', snapshotId)
        if (error) console.warn('updateDescription error:', error)
      } catch (err) {
        console.warn('updateDescription error:', err)
      }
    })
  }, [])

  const updateTitle = useCallback((title: string) => {
    Promise.resolve().then(async () => {
      try {
        const supabase = getSupabase()
        const { error } = await supabase
          .from('projects')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', projectId)
        if (error) console.warn('updateTitle error:', error)
      } catch (err) {
        console.warn('updateTitle error:', err)
      }
    })
  }, [projectId])

  return {
    loadProject,
    saveSnapshot,
    saveMessage,
    updateTips,
    updateDescription,
    updateCover,
    updateTitle,
  }
}
