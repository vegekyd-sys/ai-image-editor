import { SupabaseClient } from '@supabase/supabase-js'
import { uploadImage } from '@/lib/supabase/storage'
import { compressImageFile } from '@/lib/image/compress'
import { extractPhotoMetadata } from '@/lib/image/metadata'

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
 * Create a new project: compress files → upload to Supabase → store URLs in sessionStorage → navigate.
 * Returns the project ID, or null on failure.
 */
export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  files: File[],
  options?: { prompt?: string },
): Promise<{ projectId: string; metadata?: { takenAt?: string; location?: string } } | null> {
  // Extract EXIF from first file
  const metadata = files.length > 0 ? await extractPhotoMetadata(files[0]) : undefined
  console.log('[METADATA]', JSON.stringify(metadata))

  // Single image: compress first, then create project → store base64 (same as original flow)
  // Multi image: create project first (need ID for upload) → upload → store URLs
  if (files.length <= 1) {
    const base64 = files.length === 1 ? await compressFile(files[0]) : undefined

    const { data: project, error } = await supabase
      .from('projects')
      .insert({ user_id: userId, title: 'Untitled' })
      .select('id')
      .single()
    if (error || !project) throw new Error('Failed to create project')

    if (base64) sessionStorage.setItem('pendingImages', JSON.stringify([base64]))
    if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
    if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt)
    return { projectId: project.id, metadata }
  }

  // Multi image: create project first (need ID for storage path), then upload
  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, title: 'Untitled' })
    .select('id')
    .single()
  if (error || !project) throw new Error('Failed to create project')

  const urls = await Promise.all(files.map(async (file, i) => {
    const base64 = await compressFile(file)
    const url = await uploadImage(supabase, userId, project.id, `snapshot-upload-${i}.jpg`, base64)
    if (!url) throw new Error(`Failed to upload image ${i}`)
    return url
  }))
  sessionStorage.setItem('pendingImages', JSON.stringify(urls))
  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
  if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt)

  return { projectId: project.id, metadata }
}
