import type { SupabaseClient } from '@supabase/supabase-js'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'
import { uploadPoster } from '@/lib/supabase/storage'

function isVideoLikeUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(?:\?|#|$)/i.test(url) || /\/videos\/[^/?#]+/i.test(url)
}

export function needsVideoPosterRepair(imageUrl?: string | null): boolean {
  const current = imageUrl?.trim()
  if (!current) return true
  if (current === VIDEO_PLACEHOLDER_IMAGE || current.endsWith(VIDEO_PLACEHOLDER_IMAGE)) return true
  return isVideoLikeUrl(current)
}

export async function ensureVideoPosterForSnapshot(options: {
  admin: SupabaseClient
  ownerUserId: string
  projectId: string
  snapshotId: string
  videoUrl: string | null | undefined
  currentImageUrl?: string | null
  videoBuffer?: Buffer | Uint8Array
}): Promise<string | null> {
  if (!options.videoUrl && !options.videoBuffer) return null
  if (!needsVideoPosterRepair(options.currentImageUrl)) return options.currentImageUrl || null

  try {
    const { extractVideoPoster, extractVideoPosterFromBuffer } = await import('@/lib/video-poster')
    const posterBuffer = options.videoBuffer
      ? await extractVideoPosterFromBuffer(options.videoBuffer)
      : await extractVideoPoster(options.videoUrl as string)

    const posterUrl = await uploadPoster(
      options.admin,
      options.ownerUserId,
      options.projectId,
      options.snapshotId,
      posterBuffer,
    )
    if (!posterUrl) return null

    await options.admin
      .from('snapshots')
      .update({ image_url: posterUrl })
      .eq('id', options.snapshotId)

    console.log(`Video poster repaired: ${options.snapshotId}`)
    return posterUrl
  } catch (err) {
    console.warn(`Video poster repair failed for ${options.snapshotId} (non-fatal):`, err)
    return null
  }
}
