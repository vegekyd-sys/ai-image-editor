import { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'images'
const LEGACY_HOST = 'https://sdyrtztrjgmmpnirswxt.supabase.co'
const CDN_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL || LEGACY_HOST

/** Check if a URL is permanently stored in our Supabase Storage (not a temporary provider URL). */
export function isPermanentUrl(url: string): boolean {
  const configuredStoragePrefix = `${CDN_HOST.replace(/\/$/, '')}/storage/`
  return url.startsWith(configuredStoragePrefix)
    || url.includes('supabase.co/storage/')
    || url.includes('makaron.app/storage/')
}

export function normalizeDomain(url: string): string {
  if (url.startsWith(LEGACY_HOST) && CDN_HOST !== LEGACY_HOST) {
    return url.replace(LEGACY_HOST, CDN_HOST)
  }
  return url
}

function supportsSupabaseImageTransforms(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname !== 'localhost'
      && hostname !== '127.0.0.1'
      && hostname !== '::1'
      && hostname !== '[::1]'
  } catch {
    return true
  }
}

/** Return the Supabase storage URL with normalized domain. */
export function toPublicStorageUrl(url: string): string {
  return normalizeDomain(url)
}

export function normalizeImageFilename(filename: string, mimeType: string): string {
  const extension = mimeType === 'image/png'
    ? 'png'
    : mimeType === 'image/webp'
      ? 'webp'
      : 'jpg'
  return /\.(?:jpe?g|png|webp)$/i.test(filename)
    ? filename.replace(/\.(?:jpe?g|png|webp)$/i, `.${extension}`)
    : `${filename}.${extension}`
}

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

    const normalizedFilename = normalizeImageFilename(filename, mimeType)
    const path = `${userId}/${projectId}/${normalizedFilename}`

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mimeType,
        upsert: true,
      })

    if (error) {
      console.warn('Storage upload error:', error)
      return null
    }

    return getPublicUrl(supabase, path)
  } catch (err) {
    console.warn('uploadImage error:', err)
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
/** High-quality image via Image Transformations — triggers PNG→WebP format negotiation.
 *  width=2000 triggers the transform pipeline without visible downscale
 *  (our uploads are max 2048px, 2.3% smaller is imperceptible). quality=95 is visually lossless. */
export function getOptimizedUrl(url: string, quality = 95): string {
  if (!url || !url.includes('/storage/v1/object/public/')) return url
  // Local Supabase Storage does not expose the hosted /render/image route.
  // E2E must render the original object instead of a guaranteed 404.
  if (!supportsSupabaseImageTransforms(url)) return normalizeDomain(url)
  const base = normalizeDomain(url).replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  return base + `?width=2000&quality=${quality}`
}

/**
 * Upload a video binary to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadVideo(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  animationId: string,
  buffer: Uint8Array,
): Promise<string | null> {
  try {
    const path = `${userId}/${projectId}/videos/${animationId}.mp4`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: 'video/mp4',
        upsert: true,
      })
    if (error) {
      console.warn('Video upload error:', error)
      return null
    }
    return getPublicUrl(supabase, path)
  } catch (err) {
    console.warn('uploadVideo error:', err)
    return null
  }
}

/**
 * Upload a video poster (JPEG) to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadPoster(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  snapshotId: string,
  jpegBuffer: Uint8Array,
): Promise<string | null> {
  try {
    const path = `${userId}/${projectId}/posters/${snapshotId}.jpg`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, jpegBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      })
    if (error) {
      console.warn('Poster upload error:', error)
      return null
    }
    return getPublicUrl(supabase, path)
  } catch (err) {
    console.warn('uploadPoster error:', err)
    return null
  }
}

/**
 * Upload an audio binary to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadAudio(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  taskId: string,
  trackIndex: number,
  buffer: Uint8Array,
  format: 'mp3' | 'wav' | 'pcm' | 'ogg_opus' = 'mp3',
): Promise<string | null> {
  try {
    const audioType = {
      mp3: { extension: 'mp3', contentType: 'audio/mpeg' },
      wav: { extension: 'wav', contentType: 'audio/wav' },
      pcm: { extension: 'pcm', contentType: 'audio/L16' },
      ogg_opus: { extension: 'ogg', contentType: 'audio/ogg; codecs=opus' },
    }[format]
    const path = `${userId}/${projectId}/audio/${taskId}-${trackIndex}.${audioType.extension}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: audioType.contentType,
        upsert: true,
      })
    if (error) {
      console.warn('Audio upload error:', error)
      return null
    }
    return getPublicUrl(supabase, path)
  } catch (err) {
    console.warn('uploadAudio error:', err)
    return null
  }
}

export function getThumbnailUrl(url: string, width = 200, quality = 60, height?: number, resize: 'cover' | 'contain' = 'cover'): string {
  if (!url || !url.includes('/storage/v1/object/public/')) return url
  if (!supportsSupabaseImageTransforms(url)) return normalizeDomain(url)
  const base = normalizeDomain(url).split('?')[0].replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  const params = [`width=${width}`, `quality=${quality}`]
  if (height) params.push(`height=${height}`, `resize=${resize}`)
  return base + '?' + params.join('&')
}

export function getOriginFormatThumbnailUrl(url: string, width = 200, quality = 60, height?: number, resize: 'cover' | 'contain' = 'cover'): string {
  if (!url || !url.includes('/storage/v1/object/public/')) return url
  if (!supportsSupabaseImageTransforms(url)) return normalizeDomain(url)
  const base = normalizeDomain(url).split('?')[0].replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  const params = [`width=${width}`, `quality=${quality}`, 'format=origin']
  if (height) params.push(`height=${height}`, `resize=${resize}`)
  return base + '?' + params.join('&')
}
