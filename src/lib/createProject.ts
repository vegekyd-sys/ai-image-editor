import { SupabaseClient } from '@supabase/supabase-js'
import { uploadImage } from '@/lib/supabase/storage'
import { compressImageFile } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import type { PhotoMetadata } from '@/types'

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
    const { data, error } = await supabase.from('projects').insert({ user_id: userId, title: 'Untitled' }).select('id').single();
    if (error || !data) throw new Error('Failed to create project');
    return { projectId: data.id };
  }

  // Single image: compress + metadata + DB insert in parallel
  if (files.length <= 1) {
    const [base64, metadata, dbResult] = await Promise.all([
      compressFile(files[0]),
      preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : extractPhotoMetadata(files[0]),
      supabase.from('projects').insert({ user_id: userId, title: 'Untitled' }).select('id').single(),
    ]);
    if (dbResult.error || !dbResult.data) throw new Error('Failed to create project');
    if (base64) sessionStorage.setItem('pendingImages', JSON.stringify([base64]));
    if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));
    return { projectId: dbResult.data.id, metadata };
  }

  // Multi image: DB insert + metadata in parallel, then upload
  const [dbResult, metadata] = await Promise.all([
    supabase.from('projects').insert({ user_id: userId, title: 'Untitled' }).select('id').single(),
    preExtractedMetadata ? Promise.resolve(preExtractedMetadata) : extractPhotoMetadata(files[0]),
  ]);
  if (dbResult.error || !dbResult.data) throw new Error('Failed to create project');
  const projectId = dbResult.data.id;
  const urls = await Promise.all(files.map(async (file, i) => {
    const base64 = await compressFile(file);
    const url = await uploadImage(supabase, userId, projectId, `snapshot-upload-${i}.jpg`, base64);
    if (!url) throw new Error(`Failed to upload image ${i}`);
    return url;
  }));
  sessionStorage.setItem('pendingImages', JSON.stringify(urls));
  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata));

  return { projectId, metadata };
}
