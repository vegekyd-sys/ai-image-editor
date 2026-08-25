import { SupabaseClient } from '@supabase/supabase-js'
import { compressImageFile } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import { getMarketingAttribution } from '@/lib/marketing/attribution'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import { cacheProjectData, stagePendingProjectImages, stagePendingProjectLaunch } from '@/lib/imageCache'
import { uploadImage } from '@/lib/supabase/storage'
import type { PhotoMetadata } from '@/types'
import type { SkillLaunchContext } from '@/lib/skill-launch-context'

export interface ProjectLaunchOptions {
  prompt?: string
  skill?: string
  skillLaunchContext?: SkillLaunchContext
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)
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
    const filename = stablePrefix
      ? `${stablePrefix}-${index}.jpg`
      : `snapshot-${crypto.randomUUID()}.jpg`
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

/**
 * Create a new project and stage its initial media.
 * Images are uploaded before navigation so sessionStorage only carries compact
 * permanent URLs, never large base64 payloads.
 */
export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  files: File[],
  options?: ProjectLaunchOptions,
  preExtractedMetadata?: PhotoMetadata,
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

  // Single image (no videos): compress + metadata + DB insert in parallel
  if (imageFiles.length <= 1 && videoFiles.length === 0) {
    const [base64, metadata, projectId] = await Promise.all([
      compressCreateImageFile(imageFiles[0]),
      preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : extractPhotoMetadata(imageFiles[0]),
      createProjectShell('Untitled', marketing),
    ]);
    if (base64) {
      const imageUrls = await persistCreateImages(supabase, userId, projectId, [base64])
      await stagePendingProjectImages(projectId, imageUrls)
    }
    stageProjectLaunch(projectId, options, metadata)
    trackProjectCreated(projectId, { ...options, eventId: metaEventId });
    return { projectId, metadata };
  }

  // Multi file (images + videos): create the project server-side, then stage media locally.
  const firstImage = imageFiles[0] || files[0];
  const [projectId, metadata] = await Promise.all([
    createProjectShell('Untitled', marketing),
    preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : (!isVideoFile(firstImage) ? extractPhotoMetadata(firstImage) : Promise.resolve(undefined)),
  ]);

  const imageUrls = await Promise.all(imageFiles.map(async file => {
    const payload = await compressCreateImageFile(file)
    return (await persistCreateImages(supabase, userId, projectId, [payload]))[0]
  }))
  if (imageUrls.length) await stagePendingProjectImages(projectId, imageUrls)

  // Upload videos (transcode + upload via video-upload.ts)
  if (videoFiles.length) {
    const { uploadVideoToStorage } = await import('@/lib/video-upload');
    const videoData = await Promise.all(videoFiles.map(f => uploadVideoToStorage(f, projectId)));
    sessionStorage.setItem('pendingVideos', JSON.stringify(videoData));
  }

  stageProjectLaunch(projectId, options, metadata)

  trackProjectCreated(projectId, { ...options, eventId: metaEventId });
  return { projectId, metadata };
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
  }, staged.metadata)
  trackProjectCreated(createdProjectId, { prompt: staged.prompt, skill: staged.skill, eventId: metaEventId })
  return { projectId: createdProjectId, metadata: staged.metadata }
}
