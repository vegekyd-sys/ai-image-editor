/** Gallery rows carry a thumbnail and a count, not the entire editor history. */
export interface GalleryProject {
  id: string
  title: string
  cover_url: string | null
  updated_at: string
  created_at: string
  snapshots: { id: string; image_url: string; sort_order: number }[]
  snapshotCount?: number
  hasVideo?: boolean
}

export interface ProjectGalleryPage {
  projects: GalleryProject[]
  /** Includes confirmed empty projects, so stale cached cards can be removed. */
  scannedIds: string[]
  nextCursor: string | null
}

export async function fetchProjectGalleryPage(options: {
  cursor?: string | null
  projectId?: string
  signal?: AbortSignal
} = {}): Promise<ProjectGalleryPage> {
  const params = new URLSearchParams()
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.projectId) params.set('id', options.projectId)
  const response = await fetch(`/api/projects/gallery${params.size ? `?${params}` : ''}`, {
    signal: options.signal,
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Project gallery request failed (${response.status})`)
  const page: ProjectGalleryPage = await response.json()
  if (!Array.isArray(page.projects) || !Array.isArray(page.scannedIds)
    || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
    throw new Error('Invalid project gallery response')
  }
  return page
}

export function mergeProjectGalleryPage(
  current: GalleryProject[],
  page: ProjectGalleryPage,
  seenIds?: Set<string>,
): GalleryProject[] {
  const scanned = new Set(page.scannedIds)
  const projects = new Map(current
    .filter(project => !scanned.has(project.id)
      && (!seenIds || page.nextCursor !== null || seenIds.has(project.id)))
    .map(project => [project.id, project]))
  for (const project of page.projects) projects.set(project.id, project)
  return [...projects.values()].sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at)
      || b.created_at.localeCompare(a.created_at)
      || b.id.localeCompare(a.id))
}
