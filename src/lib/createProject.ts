import { SupabaseClient } from '@supabase/supabase-js'
import { compressImageFile, inspectDataUrlAlpha } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import { getMarketingAttribution } from '@/lib/marketing/attribution'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import { cacheProjectData, stagePendingProjectImages, stagePendingProjectLaunch } from '@/lib/imageCache'
import { dataUrlToBlob, uploadBlobWithProgress, uploadImage } from '@/lib/supabase/storage'
import { isVideoFile, prepareMedia, uploadLimiter, type MediaItemState, type PreparedMedia } from '@/lib/upload/media-queue'
import type { PhotoMetadata } from '@/types'
import type { SkillLaunchContext } from '@/lib/skill-launch-context'

export interface ProjectLaunchOptions {
  prompt?: string
  skill?: string
  skillLaunchContext?: SkillLaunchContext
}

export async function compressCreateImageFile(file: File): Promise<string> {
  try {
    return await compressImageFile(file, 2048, 0.92)
  } catch {
    console.warn('[HEIC] client conversion failed, trying server fallback')
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!res.ok) throw new Error('Server HEIC conversion failed')
    const { image } = await res.json()
    return image as string
  }
}

export async function compressCreateImageFiles(files: File[]): Promise<string[]> {
  const payloads: string[] = []
  for (const file of files) {
    payloads.push(await compressCreateImageFile(file))
  }
  return payloads
}

async function enrichImageMetadata(base64: string, metadata?: PhotoMetadata): Promise<PhotoMetadata | undefined> {
  const mimeType = base64.match(/^data:(image\/[^;]+);/i)?.[1]
  if (!mimeType) return metadata
  const hasAlpha = await inspectDataUrlAlpha(base64)
  return {
    ...metadata,
    imageMimeType: mimeType,
    hasAlpha,
    ...(hasAlpha ? { generationBackground: 'transparent' as const } : {}),
  }
}

async function createProjectShell(
  title = 'Untitled',
  marketing?: { metaEventId?: string; skillId?: string; hasPrompt?: boolean },
  idempotency?: { clientProjectId?: string; idempotencyKey?: string },
): Promise<string> {
  const res = await fetch('/api/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, ...marketing, ...idempotency }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.projectId) {
    throw new Error(data.error || 'Failed to create project')
  }
  return data.projectId as string
}

async function persistCreateImages(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  payloads: string[],
  stablePrefix?: string,
): Promise<string[]> {
  return Promise.all(payloads.map(async (payload, index) => {
    if (payload.startsWith('http')) return payload
    const extension = /^data:image\/png;/i.test(payload)
      ? 'png'
      : /^data:image\/webp;/i.test(payload)
        ? 'webp'
        : 'jpg'
    const filename = stablePrefix
      ? `${stablePrefix}-${index}.${extension}`
      : `snapshot-${crypto.randomUUID()}.${extension}`
    const url = await uploadImage(supabase, userId, projectId, filename, payload)
    if (!url) throw new Error('Failed to upload image')
    return url
  }))
}

async function persistInitialProjectSnapshots(
  projectId: string,
  imageUrls: string[],
): Promise<Array<{ snapshotId: string; imageUrl: string }>> {
  if (imageUrls.length === 0) return []
  const response = await fetch('/api/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _addToProject: projectId, imageUrls }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !Array.isArray(data.snapshots) || data.snapshots.length !== imageUrls.length) {
    throw new Error(data.error || 'Failed to persist initial project snapshots')
  }
  return data.snapshots as Array<{ snapshotId: string; imageUrl: string }>
}

function trackProjectCreated(projectId: string, options?: { prompt?: string; skill?: string; eventId?: string }) {
  const attribution = getMarketingAttribution()
  const skillId = options?.skill || attribution.skill_id
  trackMetaEvent('CustomizeProduct', {
    content_type: 'project',
    content_name: skillId || 'custom_project',
    project_id: projectId,
    skill_id: skillId,
    has_prompt: Boolean(options?.prompt),
  }, options?.eventId || createMetaEventId('project.create'))
}

function stageProjectLaunch(
  projectId: string,
  options?: ProjectLaunchOptions,
  metadata?: PhotoMetadata,
): void {
  if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt)
  if (options?.skill) sessionStorage.setItem('pendingSkill', options.skill)
  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
  stagePendingProjectLaunch(projectId, {
    prompt: options?.prompt,
    skill: options?.skill,
    skillLaunchContext: options?.skillLaunchContext,
    metadata,
  })
}

export interface CreateMediaHooks {
  /** Stable per-draft project id so a retry after a failed upload reuses the
   * same project shell and already-uploaded files. */
  clientProjectId?: string
  onItemState?: (file: File, state: MediaItemState) => void
}

export class CreateMediaUploadError extends Error {
  constructor(readonly failedFiles: File[], readonly firstError: unknown) {
    super(firstError instanceof Error ? firstError.message : String(firstError))
    this.name = 'CreateMediaUploadError'
  }
}

type VideoPersistResult = { videoUrl: string; duration: number; width: number; height: number }
type PersistResult =
  | { kind: 'image'; url: string; payload: string }
  | { kind: 'video'; video: VideoPersistResult }

// Successful uploads per (file, project): a retry only re-uploads failures.
const persistCache = new WeakMap<File, Map<string, Promise<PersistResult>>>()

function imageExtension(payload: string): { ext: string; mime: string } {
  if (/^data:image\/png;/i.test(payload)) return { ext: 'png', mime: 'image/png' }
  if (/^data:image\/webp;/i.test(payload)) return { ext: 'webp', mime: 'image/webp' }
  return { ext: 'jpg', mime: 'image/jpeg' }
}

function persistCreateMedia(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  file: File,
  onItemState?: (file: File, state: MediaItemState) => void,
): Promise<PersistResult> {
  let byProject = persistCache.get(file)
  if (!byProject) {
    byProject = new Map()
    persistCache.set(file, byProject)
  }
  const cached = byProject.get(projectId)
  if (cached) return cached

  const report = (state: MediaItemState) => onItemState?.(file, state)
  const promise = (async (): Promise<PersistResult> => {
    const prepared: PreparedMedia = await prepareMedia(file, state => {
      if (state.status === 'processing') report(state)
    })
    report({ status: 'uploading', progress: 0 })
    const onProgress = (progress: number) => report({ status: 'uploading', progress })
    return uploadLimiter(async (): Promise<PersistResult> => {
      if (prepared.kind === 'image') {
        const { payload } = prepared
        if (payload.startsWith('http')) return { kind: 'image', url: payload, payload }
        const { ext, mime } = imageExtension(payload)
        const blob = await dataUrlToBlob(payload)
        const url = await uploadBlobWithProgress(
          supabase,
          `${userId}/${projectId}/snapshot-${crypto.randomUUID()}.${ext}`,
          blob,
          mime,
          onProgress,
        )
        return { kind: 'image', url, payload }
      }
      const { uploadVideoToStorage } = await import('@/lib/video-upload')
      const video = await uploadVideoToStorage(file, projectId, (progress, stage) => {
        if (stage === 'upload') onProgress(progress)
      }, prepared.result)
      return { kind: 'video', video }
    })
  })()
  byProject.set(projectId, promise)
  promise.then(
    () => report({ status: 'done', progress: 1 }),
    (err: unknown) => {
      byProject!.delete(projectId)
      report({ status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) })
    },
  )
  return promise
}

/**
 * Create a new project and stage its initial media.
 * Images are uploaded before navigation so sessionStorage only carries compact
 * permanent URLs, never large base64 payloads.
 *
 * The project shell request and every file's prepare → upload pipeline run in
 * parallel (bounded by the shared media queue). Each file reports its state via
 * `hooks.onItemState`; if any file fails, a CreateMediaUploadError lists them
 * and a retry with the same `clientProjectId` only re-uploads the failures.
 */
export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  files: File[],
  options?: ProjectLaunchOptions,
  preExtractedMetadata?: PhotoMetadata,
  hooks?: CreateMediaHooks,
): Promise<{ projectId: string; metadata?: PhotoMetadata } | null> {
  const attribution = getMarketingAttribution()
  const metaEventId = createMetaEventId('project.create')
  const marketing = {
    metaEventId,
    skillId: options?.skill || attribution.skill_id,
    hasPrompt: Boolean(options?.prompt),
  }

  if (files.length === 0) {
    const projectId = await createProjectShell('Untitled', marketing);
    stageProjectLaunch(projectId, options)
    trackProjectCreated(projectId, { ...options, eventId: metaEventId });
    return { projectId };
  }

  const imageFiles = files.filter(f => !isVideoFile(f));
  const videoFiles = files.filter(f => isVideoFile(f));
  const projectId = hooks?.clientProjectId || crypto.randomUUID()
  const firstImage = imageFiles[0]

  const shellPromise = createProjectShell('Untitled', marketing, { clientProjectId: projectId })
  const metadataPromise: Promise<PhotoMetadata | undefined> = preExtractedMetadata
    ? Promise.resolve(preExtractedMetadata)
    : firstImage ? extractPhotoMetadata(firstImage).catch(() => undefined) : Promise.resolve(undefined)
  const settled = await Promise.allSettled(
    files.map(file => persistCreateMedia(supabase, userId, projectId, file, hooks?.onItemState)),
  )
  const createdProjectId = await shellPromise
  const failed = files.filter((_, i) => settled[i].status === 'rejected')
  if (failed.length) {
    const firstError = (settled.find(r => r.status === 'rejected') as PromiseRejectedResult).reason
    throw new CreateMediaUploadError(failed, firstError)
  }
  const results = settled.map(r => (r as PromiseFulfilledResult<PersistResult>).value)
  const images = results.filter((r): r is Extract<PersistResult, { kind: 'image' }> => r.kind === 'image')
  const videos = results.filter((r): r is Extract<PersistResult, { kind: 'video' }> => r.kind === 'video')

  if (images.length) await stagePendingProjectImages(createdProjectId, images.map(i => i.url))
  if (videoFiles.length) sessionStorage.setItem('pendingVideos', JSON.stringify(videos.map(v => v.video)))

  const metadata = await metadataPromise
  const enrichedMetadata = images[0] ? await enrichImageMetadata(images[0].payload, metadata) : metadata
  stageProjectLaunch(createdProjectId, options, enrichedMetadata)

  trackProjectCreated(createdProjectId, { ...options, eventId: metaEventId });
  return { projectId: createdProjectId, metadata: enrichedMetadata };
}

export async function createProjectFromStagedMedia(
  supabase: SupabaseClient,
  userId: string,
  staged: {
    images?: string[]
    metadata?: PhotoMetadata
    prompt?: string
    skill?: string
    skillLaunchContext?: SkillLaunchContext
    projectId?: string
    continuationId?: string
  },
): Promise<{ projectId: string; metadata?: PhotoMetadata } | null> {
  const attribution = getMarketingAttribution()
  const projectId = staged.projectId || crypto.randomUUID()
  const metaEventId = staged.continuationId
    ? `project.create.continuation.${staged.continuationId}`
    : createMetaEventId('project.create')
  const marketing = {
    metaEventId,
    skillId: staged.skill || attribution.skill_id,
    hasPrompt: Boolean(staged.prompt),
  }
  let imageUrls: string[] = []
  const metadata = staged.images?.[0]
    ? await enrichImageMetadata(staged.images[0], staged.metadata)
    : staged.metadata
  if (staged.images?.length) {
    imageUrls = await persistCreateImages(supabase, userId, projectId, staged.images, 'anonymous-source')
  }
  const createdProjectId = await createProjectShell('Untitled', marketing, {
    clientProjectId: projectId,
    idempotencyKey: staged.continuationId,
  })
  if (imageUrls.length) {
    const persistedSnapshots = await persistInitialProjectSnapshots(createdProjectId, imageUrls)
    cacheProjectData(
      createdProjectId,
      persistedSnapshots.map(({ snapshotId, imageUrl }) => ({
        id: snapshotId,
        image: imageUrl,
        imageUrl,
        tips: [],
        messageId: '',
      })),
      [],
      'Untitled',
    )
  }
  stageProjectLaunch(createdProjectId, {
    prompt: staged.prompt,
    skill: staged.skill,
    skillLaunchContext: staged.skillLaunchContext,
  }, metadata)
  trackProjectCreated(createdProjectId, { prompt: staged.prompt, skill: staged.skill, eventId: metaEventId })
  return { projectId: createdProjectId, metadata }
}
