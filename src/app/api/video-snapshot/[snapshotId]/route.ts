import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo, isPermanentUrl } from '@/lib/supabase/storage'
import type { VideoMeta } from '@/types'

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { snapshotId } = await params

    // Load snapshot with video_meta
    const { data: snap } = await supabase
      .from('snapshots')
      .select('id, project_id, video_meta, image_url')
      .eq('id', snapshotId)
      .single()

    if (!snap?.video_meta) {
      return NextResponse.json({ error: 'Not a video snapshot' }, { status: 404 })
    }

    const videoMeta = snap.video_meta as VideoMeta

    // If already completed with permanent URL, return immediately (no provider call)
    if (videoMeta.status === 'completed' && videoMeta.videoUrl) {
      const isPermanent = isPermanentUrl(videoMeta.videoUrl)
      if (isPermanent) {
        return NextResponse.json({ status: 'completed', videoUrl: videoMeta.videoUrl, snapshotId, imageUrl: snap.image_url || undefined })
      }
      // Provider URL still in DB — persist hasn't finished yet, tell caller to keep polling
      return NextResponse.json({ status: 'rendering', snapshotId, imageUrl: snap.image_url || undefined })
    }

    if (!videoMeta.taskId) {
      return NextResponse.json({ error: 'No task ID' }, { status: 400 })
    }

    // Poll provider — route by taskId prefix
    // task-unified-* = Evolink SeeDance, cgt-* = SeeDance (Volcengine), mc-* = Motion Control, else = Kling
    const isEvolink = videoMeta.taskId.startsWith('task-unified-')
    const isSeedance = videoMeta.taskId.startsWith('cgt-')
    const isMotionControl = videoMeta.taskId.startsWith('mc-')
    const provider = process.env.ANIMATE_PROVIDER || 'kling'
    let result: { taskId: string; status: string; videoUrl?: string; error?: string }
    const realTaskId = isMotionControl ? videoMeta.taskId.slice(3) : videoMeta.taskId

    if (isEvolink) {
      const { getEvolinkTask } = await import('@/lib/evolink')
      result = await getEvolinkTask(videoMeta.taskId)
    } else if (isSeedance) {
      const { getSeedanceTask } = await import('@/lib/seedance')
      result = await getSeedanceTask(videoMeta.taskId)
    } else if (isMotionControl) {
      const { getKlingMotionControlTask } = await import('@/lib/kling')
      result = await getKlingMotionControlTask(realTaskId)
      result.taskId = videoMeta.taskId
    } else if (provider === 'piapi') {
      result = await getKlingTaskPiAPI(videoMeta.taskId)
    } else {
      result = await getKlingTask(videoMeta.taskId)
    }

    if (result.status === 'completed' && result.videoUrl) {
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'completed', videoUrl: result.videoUrl, providerUrl: result.videoUrl }

      await supabase
        .from('snapshots')
        .update({ video_meta: updatedMeta })
        .eq('id', snapshotId)

      // Persist video to Supabase Storage + extract poster (after response)
      const projectId = snap.project_id
      after(async () => {
        try {
          const res = await fetch(result.videoUrl!)
          if (!res.ok) return
          const buffer = new Uint8Array(await res.arrayBuffer())

          const { probeMP4Dimensions } = await import('@/lib/mp4-probe')
          const dims = probeMP4Dimensions(buffer) || { width: 1080, height: 1920 }

          const permanentUrl = await uploadVideo(supabase, user.id, projectId, snapshotId, buffer)
          if (permanentUrl) {
            const finalMeta: VideoMeta = {
              ...updatedMeta,
              videoUrl: permanentUrl,
              videoPath: `${user.id}/projects/${projectId}/animation/${snapshotId}.mp4`,
              width: dims.width,
              height: dims.height,
            }
            await supabase
              .from('snapshots')
              .update({ video_meta: finalMeta })
              .eq('id', snapshotId)
            console.log(`Video snapshot ${snapshotId} persisted (${dims.width}x${dims.height})`)

            // Extract poster frame and update image_url
            try {
              const { extractVideoPoster } = await import('@/lib/video-poster')
              const posterBuffer = await extractVideoPoster(permanentUrl)
              const posterPath = `${user.id}/${projectId}/posters/${snapshotId}.jpg`
              const { error: posterErr } = await supabase.storage.from('images').upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true })
              if (!posterErr) {
                const { data: urlData } = supabase.storage.from('images').getPublicUrl(posterPath)
                if (urlData?.publicUrl) {
                  await supabase.from('snapshots').update({ image_url: urlData.publicUrl }).eq('id', snapshotId)
                  console.log(`Video poster extracted: ${snapshotId}`)
                }
              }
            } catch (posterErr) {
              console.warn('Video poster extraction failed (non-fatal):', posterErr)
            }
          }
        } catch (err) {
          console.error('Video snapshot persist error:', err)
        }
      })

      // Return completed immediately with provider URL — frontend can play it right away
      // after() will persist to Storage in background, subsequent loads use permanent URL
      return NextResponse.json({ status: 'completed', videoUrl: result.videoUrl, snapshotId, imageUrl: snap.image_url || undefined })
    }

    if (result.status === 'failed') {
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'failed', error: result.error || undefined }
      // Atomic refund: use conditional update to prevent double-refund from concurrent polls
      if (videoMeta.creditsCharged && !videoMeta.refunded) {
        updatedMeta.refunded = true
        const { data: updated } = await supabase
          .from('snapshots')
          .update({ video_meta: updatedMeta })
          .eq('id', snapshotId)
          .not('video_meta->>refunded', 'eq', 'true')
          .select('id')
        // Only refund if we won the race (row was actually updated)
        if (updated?.length) {
          const { refundCredits } = await import('@/lib/billing/credits')
          await refundCredits(user!.id, videoMeta.creditsCharged, 'create_video')
          console.log(`[refund] video ${snapshotId} failed, refunded ${videoMeta.creditsCharged} credits to ${user!.id}`)
        }
      } else {
        await supabase
          .from('snapshots')
          .update({ video_meta: updatedMeta })
          .eq('id', snapshotId)
      }
    }

    return NextResponse.json({ status: result.status, snapshotId, imageUrl: snap.image_url || undefined, error: result.error })
  } catch (err) {
    console.error('video-snapshot GET error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { snapshotId } = await params

    const { data: snap } = await supabase
      .from('snapshots')
      .select('video_meta')
      .eq('id', snapshotId)
      .single()

    if (snap?.video_meta) {
      const videoMeta = snap.video_meta as VideoMeta
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'abandoned' }
      await supabase
        .from('snapshots')
        .update({ video_meta: updatedMeta })
        .eq('id', snapshotId)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('video-snapshot DELETE error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
