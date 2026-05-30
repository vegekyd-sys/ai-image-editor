import { SupabaseClient } from '@supabase/supabase-js'
import { uploadImage } from '@/lib/supabase/storage'
import { compressImageFile } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import { getMarketingAttribution } from '@/lib/marketing/attribution'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import type { PhotoMetadata } from '@/types'

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)
}

async function compressFile(file: File): Promise<string> {
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

function trackProjectCreated(projectId: string, options?: { prompt?: string; skill?: string }) {
  const attribution = getMarketingAttribution()
  const skillId = options?.skill || attribution.skill_id
  trackMetaEvent('CustomizeProduct', {
    content_type: 'project',
    content_name: skillId || 'custom_project',
    project_id: projectId,
    skill_id: skillId,
    has_prompt: Boolean(options?.prompt),
  }, createMetaEventId('project.create'))
}

/**
 * Create a new project with optimistic navigation.
 * Generates UUID upfront → stores pending data in sessionStorage → returns immediately.
 * DB insert happens in the background (editor page picks it up).
 */
export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  files: File[],
  options?: { prompt?: string; skill?: string },
  preExtractedMetadata?: PhotoMetadata,
): Promise<{ projectId: string; metadata?: PhotoMetadata } | null> {
  // Store pending data for editor page
  if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt);
  if (options?.skill) sessionStorage.setItem('pendingSkill', options.skill);

  if (files.length === 0) {
    // Text-only: DB insert only (no compression), then navigate
    const { data, error } = await supabase.from('projects').insert({ user_id: userId, title: 'Untitled', timeline_version: 2 }).select('id').single();
    if (error || !data) throw new Error('Failed to create project');
    trackProjectCreated(data.id, options);
    return { projectId: data.id };
  }

  const imageFiles = files.filter(f => !isVideoFile(f));
  const videoFiles = files.filter(f => isVideoFile(f));

  // Single image (no videos): compress + metadata + DB insert in parallel
  if (imageFiles.length <= 1 && videoFiles.length === 0) {
    const [base64, metadata, dbResult] = await Promise.all([
      compressFile(imageFiles[0]),
      preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : extractPhotoMetadata(imageFiles[0]),
      supabase.from('projects').insert({ user_id: userId, title: 'Untitled', timeline_version: 2 }).select('id').single(),
    ]);
    if (dbResult.error || !dbResult.data) throw new Error('Failed to create project');
    if (base64) sessionStorage.setItem('pendingImages', JSON.stringify([base64]));
    if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));
    trackProjectCreated(dbResult.data.id, options);
    return { projectId: dbResult.data.id, metadata };
  }

  // Multi file (images + videos): DB insert + metadata in parallel, then upload
  const firstImage = imageFiles[0] || files[0];
  const [dbResult, metadata] = await Promise.all([
    supabase.from('projects').insert({ user_id: userId, title: 'Untitled', timeline_version: 2 }).select('id').single(),
    preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : (!isVideoFile(firstImage) ? extractPhotoMetadata(firstImage) : Promise.resolve(undefined)),
  ]);
  if (dbResult.error || !dbResult.data) throw new Error('Failed to create project');
  const projectId = dbResult.data.id;

  // Upload images
  const imageUrls = await Promise.all(imageFiles.map(async (file, i) => {
    const base64 = await compressFile(file);
    const url = await uploadImage(supabase, userId, projectId, `snapshot-upload-${i}.jpg`, base64);
    if (!url) throw new Error(`Failed to upload image ${i}`);
    return url;
  }));
  if (imageUrls.length) sessionStorage.setItem('pendingImages', JSON.stringify(imageUrls));

  // Upload videos (transcode + upload via video-upload.ts)
  if (videoFiles.length) {
    const { uploadVideoToStorage } = await import('@/lib/video-upload');
    const videoData = await Promise.all(videoFiles.map(f => uploadVideoToStorage(f, projectId)));
    sessionStorage.setItem('pendingVideos', JSON.stringify(videoData));
  }

  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));

  trackProjectCreated(projectId, options);
  return { projectId, metadata };
}
