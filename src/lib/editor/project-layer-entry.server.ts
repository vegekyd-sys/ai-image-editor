import { createClient } from '@/lib/supabase/server'
import { hasCompleteRasterLayerManifest } from '@/lib/layerize-design'
import { isLayerSnapshot } from './layer-preview'
import { restoreProjectSnapshot, type OpeningLayerProject } from './project-snapshot'
import type { DbSnapshot } from '@/types'

export async function readEntryMedia(projectId: string, snapshotId: string | null) {
  // Both relations are read with the viewer's cookies and row-level permissions.
  const db = await createClient()
  let query = db.from('snapshots')
    .select('id,image_url,description,type,video_meta,design_path,projects!inner(user_id,title,is_public,timeline_version)')
    .eq('project_id', projectId)
  if (snapshotId) query = query.eq('id', snapshotId)
  const { data } = await query.order('sort_order', { ascending: false }).limit(1)
    .abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (!data) return null
  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects
  return { db, row: data, project }
}

export async function readOpeningLayers(projectId: string, media: ReturnType<typeof readEntryMedia>): Promise<OpeningLayerProject | null> {
  try {
    const entry = await media
    if (!entry?.project || !entry.row.design_path ||
        !isLayerSnapshot({ id: entry.row.id, image: entry.row.image_url, imageUrl: entry.row.image_url,
          designPath: entry.row.design_path, description: entry.row.description, tips: [], messageId: '' })) return null
    const { row, db, project } = entry
    const { data: { publicUrl } } = db.storage.from('images').getPublicUrl(project.user_id + '/workspace/' + row.design_path)
    const signal = AbortSignal.timeout(8000)
    const [inventory, design] = await Promise.all([
      db.from('snapshots').select('*').eq('project_id', projectId).order('sort_order', { ascending: true }).abortSignal(signal),
      fetch(publicUrl + '?t=' + Date.now(), { cache: 'no-store', signal }).then(r => r.ok ? r.json() : null),
    ])
    if (inventory.error || !inventory.data || !hasCompleteRasterLayerManifest(design)) return null
    const snapshots = (inventory.data as DbSnapshot[]).map(restoreProjectSnapshot)
    const target = snapshots.find(s => s.id === row.id && s.designPath === row.design_path)
    if (!target) return null
    return { projectId, ownerId: project.user_id, isPublic: project.is_public === true, title: project.title,
      timelineVersion: project.timeline_version ?? 1, snapshots, snapshotId: row.id, designPath: row.design_path, design }
  } catch {
    // The client can still restore the project from its regular data sources.
    return null
  }
}
