'use client'

import { cacheProjectData } from '@/lib/imageCache'
import { createClient } from '@/lib/supabase/client'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'
import { type DbMessage, type DbSnapshot, type Message, type Snapshot, type VideoMeta } from '@/types'

const warmedProjects = new Map<string, Promise<void>>()

function toEditorSnapshot(row: DbSnapshot): Snapshot {
  const imageUrl = row.image_url || (row.type === 'video' ? VIDEO_PLACEHOLDER_IMAGE : '')
  return {
    id: row.id,
    image: imageUrl,
    tips: (Array.isArray(row.tips) ? row.tips : []).map((tip) => ({
      ...tip,
      previewStatus: tip.previewImage ? 'done' as const
        : tip.editPrompt ? 'none' as const : undefined,
    })),
    messageId: row.message_id || '',
    imageUrl: imageUrl || undefined,
    description: row.description ?? undefined,
    ...(row.type ? { type: row.type as Snapshot['type'] } : {}),
    ...(row.design_path ? { designPath: row.design_path } : {}),
    ...(row.video_meta ? { videoMeta: row.video_meta as VideoMeta } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  }
}

function toEditorMessage(row: DbMessage, snapshots: Snapshot[]): Message {
  const linkedSnapshot = row.has_image
    ? snapshots.find((snapshot) => snapshot.messageId === row.id)
    : undefined
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: new Date(row.created_at).getTime(),
    projectId: row.project_id,
    ...(linkedSnapshot ? { image: linkedSnapshot.image } : {}),
  }
}

export function warmProjectEditorCache(projectId: string, userId?: string): Promise<void> {
  if (!projectId) return Promise.resolve()
  const existing = warmedProjects.get(projectId)
  if (existing) return existing

  const task = Promise.resolve().then(async () => {
    const supabase = createClient()
    const [snapshotsRes, messagesRes, projectRes] = await Promise.all([
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
        .select('title, user_id')
        .eq('id', projectId)
        .single(),
    ])

    if (projectRes.error || snapshotsRes.error || messagesRes.error) return
    if (userId && projectRes.data?.user_id && projectRes.data.user_id !== userId) return

    const snapshots = ((snapshotsRes.data ?? []) as DbSnapshot[]).map(toEditorSnapshot)
    if (snapshots.length === 0) return
    const messages = ((messagesRes.data ?? []) as DbMessage[]).map((row) => toEditorMessage(row, snapshots))
    cacheProjectData(projectId, snapshots, messages, projectRes.data?.title ?? 'Untitled')
  }).catch(() => {
    warmedProjects.delete(projectId)
  })

  warmedProjects.set(projectId, task)
  return task
}

export function warmProjectEditorCaches(projectIds: string[], userId?: string, limit = 6): void {
  const uniqueIds = Array.from(new Set(projectIds)).slice(0, limit)
  uniqueIds.forEach((projectId) => {
    void warmProjectEditorCache(projectId, userId)
  })
}
