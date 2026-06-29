import { SupabaseClient } from '@supabase/supabase-js'
import { compressImageFile } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import { getMarketingAttribution } from '@/lib/marketing/attribution'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import type { PhotoMetadata } from '@/types'

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

async function createProjectShell(
  title = 'Untitled',
  marketing?: { metaEventId?: string; skillId?: string; hasPrompt?: boolean },
): Promise<string> {
  const res = await fetch('/api/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, ...marketing }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.projectId) {
    throw new Error(data.error || 'Failed to create project')
  }
  return data.projectId as string
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

/**
 * Create a new project with optimistic navigation.
 * Creates the project through the backend, stores pending media in sessionStorage,
 * then lets the editor page render and persist the initial timeline.
 */
export async function createProject(
  _supabase: SupabaseClient,
  _userId: string,
  files: File[],
  options?: { prompt?: string; skill?: string },
  preExtractedMetadata?: PhotoMetadata,
): Promise<{ projectId: string; metadata?: PhotoMetadata } | null> {
  // Store pending data for editor page
  if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt);
  if (options?.skill) sessionStorage.setItem('pendingSkill', options.skill);
  const attribution = getMarketingAttribution()
  const metaEventId = createMetaEventId('project.create')
  const marketing = {
    metaEventId,
    skillId: options?.skill || attribution.skill_id,
    hasPrompt: Boolean(options?.prompt),
  }

  if (files.length === 0) {
    const projectId = await createProjectShell('Untitled', marketing);
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
    if (base64) sessionStorage.setItem('pendingImages', JSON.stringify([base64]));
    if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));
    trackProjectCreated(projectId, { ...options, eventId: metaEventId });
    return { projectId, metadata };
  }

  // Multi file (images + videos): create the project server-side, then stage media locally.
  const firstImage = imageFiles[0] || files[0];
  const [projectId, metadata, imagePayloads] = await Promise.all([
    createProjectShell('Untitled', marketing),
    preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : (!isVideoFile(firstImage) ? extractPhotoMetadata(firstImage) : Promise.resolve(undefined)),
    Promise.all(imageFiles.map(file => compressCreateImageFile(file))),
  ]);

  if (imagePayloads.length) sessionStorage.setItem('pendingImages', JSON.stringify(imagePayloads));

  // Upload videos (transcode + upload via video-upload.ts)
  if (videoFiles.length) {
    const { uploadVideoToStorage } = await import('@/lib/video-upload');
    const videoData = await Promise.all(videoFiles.map(f => uploadVideoToStorage(f, projectId)));
    sessionStorage.setItem('pendingVideos', JSON.stringify(videoData));
  }

  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));

  trackProjectCreated(projectId, { ...options, eventId: metaEventId });
  return { projectId, metadata };
}

export async function createProjectFromStagedMedia(
  _supabase: SupabaseClient,
  _userId: string,
  staged: {
    images?: string[]
    metadata?: PhotoMetadata
    prompt?: string
    skill?: string
  },
): Promise<{ projectId: string; metadata?: PhotoMetadata } | null> {
  if (staged.prompt) sessionStorage.setItem('pendingPrompt', staged.prompt)
  if (staged.skill) sessionStorage.setItem('pendingSkill', staged.skill)
  if (staged.images?.length) sessionStorage.setItem('pendingImages', JSON.stringify(staged.images))
  if (staged.metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(staged.metadata))

  const attribution = getMarketingAttribution()
  const metaEventId = createMetaEventId('project.create')
  const marketing = {
    metaEventId,
    skillId: staged.skill || attribution.skill_id,
    hasPrompt: Boolean(staged.prompt),
  }
  const projectId = await createProjectShell('Untitled', marketing)
  trackProjectCreated(projectId, { prompt: staged.prompt, skill: staged.skill, eventId: metaEventId })
  return { projectId, metadata: staged.metadata }
}
