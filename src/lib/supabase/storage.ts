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
    : mimeType === 'image/webp' ? 'webp'
      : mimeType === 'image/gif' ? 'gif'
        : mimeType === 'image/svg+xml' ? 'svg' : 'jpg'
  return /\.(?:jpe?g|png|webp|gif|svg)$/i.test(filename)
    ? filename.replace(/\.(?:jpe?g|png|webp|gif|svg)$/i, `.${extension}`)
    : `${filename}.${extension}`
}

export function parseImageDataUrl(base64DataUrl: string): { mimeType: string; base64Data: string } | null {
  if (!base64DataUrl.startsWith('data:image/')) return null
  const separator = base64DataUrl.indexOf(';base64,')
  if (separator < 0) return null
  const mimeType = base64DataUrl.slice(5, separator)
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return null
  const base64Data = base64DataUrl.slice(separator + ';base64,'.length)
  return base64Data ? { mimeType, base64Data } : null
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
    const parsed = parseImageDataUrl(base64DataUrl)
    if (!parsed) return null
    const { mimeType, base64Data } = parsed

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
 *  Workspace media can exceed 2000px. Supabase's default cover mode crops a
 *  width-only transform instead of scaling the whole image, so request contain. */
export function getOptimizedUrl(url: string, quality = 95): string {
  if (!url || /\.(gif|svg)(?:[?#]|$)/i.test(url) || !url.includes('/storage/v1/object/public/')) return url
  // Local Supabase Storage does not expose the hosted /render/image route.
  // E2E must render the original object instead of a guaranteed 404.
  if (!supportsSupabaseImageTransforms(url)) return normalizeDomain(url)
  const base = normalizeDomain(url).replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  return base + `?width=2000&quality=${quality}&resize=contain`
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
  if (!url || /\.(gif|svg)(?:[?#]|$)/i.test(url) || !url.includes('/storage/v1/object/public/')) return url
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
  if (!url || /\.(gif|svg)(?:[?#]|$)/i.test(url) || !url.includes('/storage/v1/object/public/')) return url
  if (!supportsSupabaseImageTransforms(url)) return normalizeDomain(url)
  const base = normalizeDomain(url).split('?')[0].replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  const params = [`width=${width}`, `quality=${quality}`, 'format=origin']
  if (height) params.push(`height=${height}`, `resize=${resize}`)
  return base + '?' + params.join('&')
}

/** Decode a data URL into a typed Blob without the per-byte string loop on the
 * main thread (fetch decodes data URLs natively). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024 // Supabase TUS requires 6MB chunks
const RESUMABLE_MIN_SIZE = 8 * 1024 * 1024

function utf8Base64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

/** PATCH one chunk via XHR so progress is reported within the chunk too. */
function patchChunk(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (loaded: number) => void,
): Promise<{ status: number; offset: number | null } | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PATCH', url)
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.timeout = 120_000
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = () => {
      const raw = xhr.getResponseHeader('Upload-Offset')
      resolve({ status: xhr.status, offset: raw === null ? null : Number(raw) })
    }
    xhr.onerror = () => resolve(null)
    xhr.ontimeout = () => resolve(null)
    xhr.send(body)
  })
}

/**
 * Resumable (TUS) upload in 6MB chunks. On a flaky uplink only the failed
 * chunk is re-sent instead of restarting a 30MB video from zero.
 * Returns false when the resumable endpoint is unavailable so callers can
 * fall back to a single-request upload.
 */
async function uploadResumable(
  baseUrl: string,
  anonKey: string,
  token: string,
  path: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`
  const headers = {
    'Tus-Resumable': '1.0.0',
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
    'x-upsert': 'true',
  }
  const metadata = Object.entries({ bucketName: BUCKET, objectName: path, contentType, cacheControl: '3600' })
    .map(([key, value]) => `${key} ${utf8Base64(value)}`).join(',')
  let created: Response
  try {
    created = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Upload-Length': String(blob.size), 'Upload-Metadata': metadata },
    })
  } catch {
    return false
  }
  const locationHeader = created.headers.get('location')
  if (!created.ok || !locationHeader) {
    if (created.status >= 400 && created.status < 500 && created.status !== 404) {
      let message = `Storage upload failed (${created.status})`
      try { message = (await created.json()).message || message } catch { /* keep status */ }
      throw new Error(message)
    }
    return false
  }
  const location = new URL(locationHeader, endpoint).toString()
  const size = blob.size
  let offset = 0
  let retries = 0
  while (offset < size) {
    const length = Math.min(RESUMABLE_CHUNK_SIZE, size - offset)
    const start = offset
    const result = await patchChunk(
      location,
      { ...headers, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
      blob.slice(offset, offset + length),
      loaded => onProgress?.(Math.min(0.99, (start + loaded) / size)),
    )
    if (result && result.status >= 200 && result.status < 300 && result.offset === offset + length) {
      offset = result.offset
      retries = 0
      continue
    }
    if (result && result.status >= 400 && result.status < 500 && ![408, 409, 429].includes(result.status)) {
      throw new Error(`Storage upload failed (${result.status})`)
    }
    if (++retries > 4) throw new Error('Upload interrupted. Check your network and retry.')
    await new Promise(resolve => setTimeout(resolve, 1000 * retries))
    // A lost response may still mean the chunk committed; HEAD reconciles it.
    const head = await fetch(location, { method: 'HEAD', headers }).catch(() => null)
    const committed = head?.ok ? Number(head.headers.get('Upload-Offset')) : NaN
    if (Number.isSafeInteger(committed) && committed >= offset && committed <= size) offset = committed
  }
  onProgress?.(1)
  return true
}

/**
 * Upload a Blob to the images bucket with byte-level progress.
 *
 * supabase-js uses fetch(), which cannot report upload progress. This mirrors
 * its Blob upload request (FormData + cacheControl + x-upsert) over XHR so the
 * UI can show "uploading 42%". Files ≥8MB use resumable 6MB TUS chunks so a
 * dropped connection only re-sends one chunk. If the XHR path fails for any
 * reason other than an explicit storage error, it falls back to supabase-js.
 */
export async function uploadBlobWithProgress(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const typed = blob.type === contentType ? blob : new Blob([blob], { type: contentType })
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  if (typeof XMLHttpRequest !== 'undefined' && baseUrl && anonKey && token && typed.size >= RESUMABLE_MIN_SIZE) {
    try {
      const startedAt = Date.now()
      if (await uploadResumable(baseUrl, anonKey, token, path, typed, contentType, onProgress)) {
        console.log(`[upload] resumable ${(typed.size / 1048576).toFixed(1)}MB in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
        return getPublicUrl(supabase, path)
      }
    } catch (err) {
      // Explicit storage rejections (size/policy) won't succeed another way.
      if (err instanceof Error && /^Storage upload failed/.test(err.message)) throw err
      console.warn('[upload] resumable upload failed, falling back to single request', err)
    }
    onProgress?.(0)
  }

  if (typeof XMLHttpRequest !== 'undefined' && baseUrl && anonKey && token) {
    const objectPath = path.split('/').map(encodeURIComponent).join('/')
    const url = `${baseUrl.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${objectPath}`
    const outcome = await new Promise<'ok' | 'network' | Error>((resolve) => {
      const form = new FormData()
      form.append('cacheControl', '3600')
      form.append('', typed)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', anonKey)
      xhr.setRequestHeader('x-upsert', 'true')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(0.99, event.loaded / event.total))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve('ok')
        let message = `Storage upload failed (${xhr.status})`
        try {
          const body = JSON.parse(xhr.responseText || '{}')
          message = body.message || body.error || message
        } catch { /* keep status message */ }
        // Auth/size/policy errors would fail the same way through supabase-js.
        resolve(xhr.status >= 400 && xhr.status < 500 ? new Error(message) : 'network')
      }
      xhr.onerror = () => resolve('network')
      xhr.ontimeout = () => resolve('network')
      xhr.send(form)
    })
    if (outcome === 'ok') {
      onProgress?.(1)
      return getPublicUrl(supabase, path)
    }
    if (outcome instanceof Error) throw outcome
    console.warn('[upload] XHR upload failed, retrying with supabase-js', path)
  }

  const { error } = await supabase.storage.from(BUCKET).upload(path, typed, { contentType, upsert: true })
  if (error) throw error
  onProgress?.(1)
  return getPublicUrl(supabase, path)
}
