import type { SupabaseClient } from '@supabase/supabase-js'
import type { GalleryProject, ProjectGalleryPage } from '@/lib/project-gallery'

const PROJECT_PAGE_SIZE = 24
const MEDIA_PAGE_SIZE = 500
const PROJECT_COLUMNS = 'id, title, cover_url, updated_at, created_at'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ProjectRow = Omit<GalleryProject, 'snapshots' | 'snapshotCount' | 'hasVideo'>
type Cursor = { createdAt: string; id: string }

export function parseGalleryCursor(value: string): Cursor {
  if (value.length > 256) throw new Error('Invalid cursor')
  const cursor: Cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  if (!UUID.test(cursor.id) || typeof cursor.createdAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(cursor.createdAt)
    || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error('Invalid cursor')
  return cursor
}

export function isGalleryProjectId(value: string): boolean {
  return UUID.test(value)
}

export async function readProjectGalleryPage(
  admin: SupabaseClient,
  userId: string,
  options: { cursor?: Cursor; projectId?: string } = {},
): Promise<ProjectGalleryPage> {
  // Authenticate before calling, then scope every project lookup to that owner.
  // Keep the candidate page small: large authenticated snapshot fan-outs and
  // correlated per-project aggregates can time out on established accounts.
  let query = admin.from('projects').select(PROJECT_COLUMNS).eq('user_id', userId)
  if (options.projectId) query = query.eq('id', options.projectId)
  if (options.cursor) {
    const { createdAt, id } = options.cursor
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
  }
  const { data, error } = await query
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(PROJECT_PAGE_SIZE + 1)
  if (error) throw error
  if (!data) throw new Error('Missing project rows')
  const rows = (data as ProjectRow[]).slice(0, PROJECT_PAGE_SIZE)
  if (rows.length === 0) return { projects: [], scannedIds: [], nextCursor: null }
  const ids = rows.map(project => project.id)
  const summaries = new Map(ids.map(id => [id, {
    count: 0,
    hasMedia: false,
    hasVideo: false,
    cover: null as GalleryProject['snapshots'][number] | null,
  }]))

  // Scan only this page's snapshots, in bounded responses. This also avoids
  // silently truncating a project with >1000 snapshots. A failed scan fails the
  // page; it never becomes a successful "empty project" response.
  for (let offset = 0; ; offset += MEDIA_PAGE_SIZE) {
    const { data: snapshots, error: snapshotError } = await admin.from('snapshots')
      .select('id, project_id, image_url, sort_order, type')
      .in('project_id', ids).order('id', { ascending: true })
      .range(offset, offset + MEDIA_PAGE_SIZE - 1)
    if (snapshotError) throw snapshotError
    if (!snapshots) throw new Error('Missing snapshot rows')
    for (const snapshot of snapshots) {
      const summary = summaries.get(snapshot.project_id)
      if (!summary) continue
      summary.count++
      summary.hasVideo ||= snapshot.type === 'video'
      summary.hasMedia ||= Boolean(snapshot.image_url) || snapshot.type === 'video'
      const image = snapshot.image_url as string | null
      if (image && !image.endsWith('/video-placeholder.png')) {
        const previous = summary.cover
        if (!previous || snapshot.sort_order > previous.sort_order
          || (snapshot.sort_order === previous.sort_order && snapshot.id > previous.id)) {
          summary.cover = { id: snapshot.id, image_url: image, sort_order: snapshot.sort_order }
        }
      }
    }
    if (snapshots.length < MEDIA_PAGE_SIZE) break
  }

  // Legacy animations also have video badges. This is bounded to the same
  // owned IDs; no giant IN list or per-project query is needed.
  for (let offset = 0; ; offset += MEDIA_PAGE_SIZE) {
    const { data: animations, error: animationError } = await admin.from('project_animations')
      .select('id, project_id').in('project_id', ids).eq('status', 'completed')
      .not('video_url', 'is', null).neq('video_url', '')
      .order('id', { ascending: true }).range(offset, offset + MEDIA_PAGE_SIZE - 1)
    if (animationError) throw animationError
    if (!animations) throw new Error('Missing animation rows')
    for (const animation of animations) {
      const summary = summaries.get(animation.project_id)
      if (summary) { summary.hasVideo = true; summary.hasMedia = true }
    }
    if (animations.length < MEDIA_PAGE_SIZE) break
  }

  const projects = rows.flatMap(project => {
    const summary = summaries.get(project.id)!
    if (!summary.hasMedia) return []
    return [{
      ...project,
      snapshots: summary.cover ? [summary.cover] : [],
      snapshotCount: summary.count,
      hasVideo: summary.hasVideo,
    }]
  })
  const last = rows.at(-1)!
  return {
    projects,
    scannedIds: ids,
    nextCursor: data.length > PROJECT_PAGE_SIZE
      ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url')
      : null,
  }
}
