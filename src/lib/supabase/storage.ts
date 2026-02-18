import { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'images'

/**
 * Upload a base64 data URL image to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadImage(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  filename: string,
  base64DataUrl: string,
): Promise<string | null> {
  try {
    // Extract raw base64 and mime type from data URL
    const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/)
    if (!match) return null

    const mimeType = match[1]
    const base64Data = match[2]

    // Convert base64 to Uint8Array
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    const path = `${userId}/${projectId}/${filename}`

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mimeType,
        upsert: true,
      })

    if (error) {
      console.error('Storage upload error:', error)
      return null
    }

    return getPublicUrl(supabase, path)
  } catch (err) {
    console.error('uploadImage error:', err)
    return null
  }
}

/**
 * Get the public URL for a file in the images bucket.
 */
export function getPublicUrl(supabase: SupabaseClient, path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Convert a Supabase Storage public URL to a thumbnail URL using
 * Supabase Image Transformations. Falls back to original URL if
 * the URL format doesn't match.
 *
 * Replaces /object/public/ with /render/image/public/ and appends
 * width/quality params.
 */
export function getThumbnailUrl(url: string, width = 200, quality = 60): string {
  if (!url || !url.includes('/storage/v1/object/public/')) return url
  return url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  ) + `?width=${width}&quality=${quality}`
}
