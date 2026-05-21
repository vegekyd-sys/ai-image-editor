import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * POST /api/video-poster — Extract poster frame from video and upload to Storage.
 *
 * Body: { videoUrl, projectId, snapshotId }
 * Returns: { posterUrl }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId } = authResult.auth

    const { videoUrl, projectId, snapshotId } = await req.json()

    if (!videoUrl || !projectId || !snapshotId) {
      return NextResponse.json({ error: 'videoUrl, projectId, and snapshotId are required' }, { status: 400 })
    }

    const { extractVideoPoster } = await import('@/lib/video-poster')
    const posterBuffer = await extractVideoPoster(videoUrl)

    const admin = getSupabaseAdmin()
    const posterPath = `${userId}/${projectId}/posters/${snapshotId}.jpg`
    const { error: uploadError } = await admin.storage
      .from('images')
      .upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true })

    if (uploadError) {
      return NextResponse.json({ error: `Poster upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { data: urlData } = admin.storage.from('images').getPublicUrl(posterPath)
    const posterUrl = urlData?.publicUrl || ''

    // Update snapshot image_url
    await admin.from('snapshots').update({ image_url: posterUrl }).eq('id', snapshotId)

    return NextResponse.json({ posterUrl })
  } catch (err) {
    console.error('video-poster error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
