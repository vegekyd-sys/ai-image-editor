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
  options?: { prompt?: string; skill?: string },
): Promise<{ projectId: string; metadata?: { takenAt?: string; location?: string } } | null> {
  // Single image: compress + metadata + DB insert in parallel, then navigate immediately
  // Multi image: create project first (need ID for upload) → upload → store URLs
  if (files.length <= 1) {
    // Run compress, metadata, and DB insert in parallel — none depend on each other
    const [base64, metadata, projectResult] = await Promise.all([
      files.length === 1 ? compressFile(files[0]) : Promise.resolve(undefined),
      files.length > 0 ? extractPhotoMetadata(files[0]) : Promise.resolve(undefined),
      supabase.from('projects').insert({ user_id: userId, title: 'Untitled' }).select('id').single(),
    ])
    console.log('[METADATA]', JSON.stringify(metadata))

    if (projectResult.error || !projectResult.data) throw new Error('Failed to create project')
    const project = projectResult.data

    if (base64) sessionStorage.setItem('pendingImages', JSON.stringify([base64]))
    if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
    if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt)
    if (options?.skill) sessionStorage.setItem('pendingSkill', options.skill)
    return { projectId: project.id, metadata }
  }

  // Multi image: create project + extract metadata in parallel, then upload
  const [projectResult, metadata] = await Promise.all([
    supabase.from('projects').insert({ user_id: userId, title: 'Untitled' }).select('id').single(),
    extractPhotoMetadata(files[0]),
  ])
  console.log('[METADATA]', JSON.stringify(metadata))
  if (projectResult.error || !projectResult.data) throw new Error('Failed to create project')
  const project = projectResult.data

  const urls = await Promise.all(files.map(async (file, i) => {
    const base64 = await compressFile(file)
    const url = await uploadImage(supabase, userId, project.id, `snapshot-upload-${i}.jpg`, base64)
    if (!url) throw new Error(`Failed to upload image ${i}`)
    return url
  }))
  sessionStorage.setItem('pendingImages', JSON.stringify(urls))
  if (metadata) sessionStorage.setItem('pendingMetadata', JSON.stringify(metadata))
  if (options?.prompt) sessionStorage.setItem('pendingPrompt', options.prompt)
  if (options?.skill) sessionStorage.setItem('pendingSkill', options.skill)

  return { projectId: project.id, metadata }
}
