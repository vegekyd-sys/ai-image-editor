import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo, uploadPoster } from '@/lib/supabase/storage'
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
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'completed', videoUrl: result.videoUrl }

      await supabase
        .from('snapshots')
        .update({ video_meta: updatedMeta })
        .eq('id', snapshotId)

      // Persist video + extract poster (after response)
      const projectId = snap.project_id
      after(async () => {
        const t0 = Date.now()
        try {
          const res = await fetch(result.videoUrl!)
          if (!res.ok) return
          const buffer = new Uint8Array(await res.arrayBuffer())
          console.log(`[poster] Video downloaded: ${Date.now() - t0}ms (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`)

          // Parse video dimensions from MP4 header
          const { probeMP4Dimensions } = await import('@/lib/mp4-probe')
          const dims = probeMP4Dimensions(buffer) || { width: 1080, height: 1920 }
          console.log(`[poster] Dimensions: ${dims.width}x${dims.height}`)

          // Upload video + extract poster in parallel
          // Poster uses the original CDN URL (no need to wait for Supabase upload)
          const { captureVideoPoster } = await import('@/lib/video-poster')
          const [permanentUrl, posterBuffer] = await Promise.all([
            uploadVideo(supabase, user.id, projectId, snapshotId, buffer),
            captureVideoPoster(result.videoUrl!, dims.width, dims.height, videoMeta.duration || undefined).catch(() => null),
          ])
          console.log(`[poster] Video uploaded + frame captured: ${Date.now() - t0}ms`)

          let posterUrl: string | null = null
          if (posterBuffer) {
            posterUrl = await uploadPoster(supabase, user.id, projectId, snapshotId, new Uint8Array(posterBuffer))
            console.log(`[poster] Poster uploaded: ${Date.now() - t0}ms`)
          }

          // Update DB — video URL + dimensions + poster
          if (permanentUrl) {
            const finalMeta: VideoMeta = {
              ...updatedMeta,
              videoUrl: permanentUrl,
              videoPath: `${user.id}/projects/${projectId}/animation/${snapshotId}.mp4`,
              width: dims.width,
              height: dims.height,
            }
            const update: Record<string, unknown> = { video_meta: finalMeta }
            if (posterUrl) update.image_url = posterUrl
            await supabase
              .from('snapshots')
              .update(update)
              .eq('id', snapshotId)
            console.log(`[poster] Done: ${Date.now() - t0}ms total, poster=${!!posterUrl}`)
          }
        } catch (err) {
          console.error('Video snapshot persist error:', err)
        }
      })

      return NextResponse.json({ status: 'completed', videoUrl: result.videoUrl, snapshotId, imageUrl: snap.image_url || undefined })
    }

    if (result.status === 'failed') {
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'failed', error: result.error || undefined }
      await supabase
        .from('snapshots')
        .update({ video_meta: updatedMeta })
        .eq('id', snapshotId)
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
