import { SupabaseClient } from '@supabase/supabase-js'
import { uploadImage } from '@/lib/supabase/storage'
import { ensureDecodableFile } from '@/lib/imageUtils'

/**
 * Compress a File to base64 JPEG (max 2048px, quality 0.92).
 * Handles HEIC via ensureDecodableFile, with server fallback.
 */
async function compressFile(file: File): Promise<string> {
  try {
    const decodable = await ensureDecodableFile(file)
    return await new Promise<string>((resolve, reject) => {
      const url = URL.createObjectURL(decodable)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        const maxSize = 2048
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      }
      img.onerror = reject
      img.src = url
    })
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
 * Extract EXIF metadata (date + location) from a photo file.
 */
async function extractMetadata(file: File): Promise<{ takenAt?: string; location?: string } | undefined> {
  try {
    const exifr = (await import('exifr')).default
    const exif = await exifr.parse(file, { gps: true, reviveValues: false })
    console.log('[EXIF]', JSON.stringify({ lat: exif?.latitude, lng: exif?.longitude, date: exif?.DateTimeOriginal }))
    if (!exif) return undefined

    const lat = exif.latitude; const lng = exif.longitude
    const datetimeRaw: string | undefined = exif.DateTimeOriginal || exif.CreateDate
    let takenAt: string | undefined
    if (datetimeRaw && typeof datetimeRaw === 'string') {
      const m = datetimeRaw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
      if (m) {
        const utcOffset = lat !== undefined && lng !== undefined ? Math.round(lng / 15) : undefined
        const tzStr = utcOffset !== undefined ? ` (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset})` : ''
        takenAt = `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日 ${m[4]}:${m[5]}${tzStr}`
      }
    }

    let location: string | undefined
    if (lat && lng) {
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`,
          { headers: { 'User-Agent': 'Makaron-App/1.0' } },
        )
        if (geoRes.ok) {
          const geo = await geoRes.json()
          const addr = geo.address
          const city = addr.city || addr.town || addr.village || addr.county
          location = [city, addr.country].filter(Boolean).join(', ')
          console.log('[GEOCODE]', location, '| addr:', JSON.stringify(addr))
        }
      } catch (e) { console.log('[GEOCODE] error:', e) }
    }

    if (takenAt || location) return { takenAt, location }
  } catch { /* EXIF reading is non-critical */ }
  return undefined
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
  const metadata = files.length > 0 ? await extractMetadata(files[0]) : undefined
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
