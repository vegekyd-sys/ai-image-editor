import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo } from '@/lib/supabase/storage'
import { createVideoDesign } from '@/lib/video-design'
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
      .select('id, project_id, video_meta')
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
    const isSeedance = videoMeta.taskId.startsWith('cgt-')
    const isMotionControl = videoMeta.taskId.startsWith('mc-')
    const provider = process.env.ANIMATE_PROVIDER || 'kling'
    let result: { taskId: string; status: string; videoUrl?: string; error?: string }
    const realTaskId = isMotionControl ? videoMeta.taskId.slice(3) : videoMeta.taskId

    if (isSeedance) {
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

      // Persist video to Storage + generate Remotion wrapper design (after response)
      const projectId = snap.project_id
      after(async () => {
        try {
          const res = await fetch(result.videoUrl!)
          if (!res.ok) return
          const buffer = new Uint8Array(await res.arrayBuffer())
          const permanentUrl = await uploadVideo(supabase, user.id, projectId, snapshotId, buffer)
          if (permanentUrl) {
            const finalMeta: VideoMeta = { ...updatedMeta, videoUrl: permanentUrl, videoPath: `${user.id}/projects/${projectId}/animation/${snapshotId}.mp4` }

            // Generate Remotion wrapper design
            const design = createVideoDesign(permanentUrl, 1080, 1440, videoMeta.duration || 10)
            const designPath = `code/${snapshotId}.json`
            const designJson = JSON.stringify(design)
            await supabase.storage.from('images')
              .upload(`${user.id}/workspace/${designPath}`, new Blob([designJson], { type: 'application/json' }), { upsert: true })

            await supabase
              .from('snapshots')
              .update({ video_meta: finalMeta, design_path: designPath })
              .eq('id', snapshotId)

            console.log(`Video snapshot ${snapshotId} persisted + design created`)
          }
        } catch (err) {
          console.error('Video snapshot persist error:', err)
        }
      })

      return NextResponse.json({ status: 'completed', videoUrl: result.videoUrl, snapshotId })
    }

    if (result.status === 'failed') {
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'failed' }
      await supabase
        .from('snapshots')
        .update({ video_meta: updatedMeta })
        .eq('id', snapshotId)
    }

    return NextResponse.json({ status: result.status, snapshotId })
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
