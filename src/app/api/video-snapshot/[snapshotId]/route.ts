import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo, isPermanentUrl } from '@/lib/supabase/storage'
import type { VideoMeta } from '@/types'
import { buildVideoFailureActions } from '@/lib/artifact-actions'
import { getRemotionExportJob } from '@/lib/remotion-export'

export const maxDuration = 60

type SnapshotProject = { user_id?: string; is_public?: boolean } | Array<{ user_id?: string; is_public?: boolean }>

function getProjectInfo(projects: SnapshotProject | null | undefined) {
  return Array.isArray(projects) ? projects[0] : projects
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  try {
    const { snapshotId } = await params
    const admin = getSupabaseAdmin()
    const authResult = await authenticateRequest(req)
    const authUserId = 'auth' in authResult ? authResult.auth.userId : null
    const hasBearerAuth = req.headers.get('authorization')?.startsWith('Bearer ') ?? false

    // Load snapshot with video_meta
    const { data: snap } = await admin
      .from('snapshots')
      .select('id, project_id, video_meta, image_url, projects(user_id, is_public)')
      .eq('id', snapshotId)
      .maybeSingle()

    if (!snap?.video_meta) {
      return NextResponse.json({ error: 'Not a video snapshot' }, { status: 404 })
    }

    const project = getProjectInfo(snap.projects as SnapshotProject)
    const ownerUserId = project?.user_id
    const isPublic = project?.is_public === true
    if (!isPublic && (!authUserId || authUserId !== ownerUserId)) {
      return 'error' in authResult ? authResult.error : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (hasBearerAuth && 'error' in authResult) return authResult.error
    if (!ownerUserId) return NextResponse.json({ error: 'Project owner not found' }, { status: 404 })

    const videoMeta = snap.video_meta as VideoMeta

    // If already completed with permanent URL, return immediately (no provider call)
    if (videoMeta.status === 'completed' && videoMeta.videoUrl) {
      const isPermanent = isPermanentUrl(videoMeta.videoUrl)
      const isRemotionExport = videoMeta.taskId?.startsWith('remotion-export-') === true
      if (isPermanent || isRemotionExport) {
        return NextResponse.json({ status: 'completed', videoUrl: videoMeta.videoUrl, snapshotId, imageUrl: snap.image_url || undefined })
      }
      // Provider URL still in DB — persist hasn't finished yet, tell caller to keep polling
      return NextResponse.json({ status: 'rendering', snapshotId, imageUrl: snap.image_url || undefined })
    }
    if (videoMeta.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        snapshotId,
        imageUrl: snap.image_url || undefined,
        error: videoMeta.error,
        completionActions: buildVideoFailureActions(videoMeta),
      })
    }

    if (!videoMeta.taskId) {
      return NextResponse.json({ error: 'No task ID' }, { status: 400 })
    }

    if (videoMeta.taskId.startsWith('remotion-export-pending-')) {
      return NextResponse.json({
        status: 'processing',
        snapshotId,
        imageUrl: snap.image_url || undefined,
        error: videoMeta.error,
      })
    }

    if (videoMeta.taskId.startsWith('remotion-export-')) {
      const jobId = videoMeta.taskId.slice('remotion-export-'.length)
      const job = await getRemotionExportJob(jobId)
      if (!job) return NextResponse.json({ status: 'processing', snapshotId, imageUrl: snap.image_url || undefined })
      if (job.status === 'completed' && job.storage_url) {
        const updatedMeta: VideoMeta = {
          ...videoMeta,
          status: 'completed',
          videoUrl: job.storage_url,
          providerUrl: job.storage_url,
          videoPath: job.workspace_path || videoMeta.videoPath,
          duration: job.duration_seconds || videoMeta.duration,
          width: job.width || videoMeta.width,
          height: job.height || videoMeta.height,
        }
        await admin.from('snapshots').update({ video_meta: updatedMeta }).eq('id', snapshotId)
        return NextResponse.json({ status: 'completed', videoUrl: job.storage_url, snapshotId, imageUrl: snap.image_url || undefined })
      }
      if (job.status === 'failed') {
        const updatedMeta: VideoMeta = { ...videoMeta, status: 'failed', error: job.error || 'Remotion export failed' }
        await admin.from('snapshots').update({ video_meta: updatedMeta }).eq('id', snapshotId)
        return NextResponse.json({
          status: 'failed',
          snapshotId,
          imageUrl: snap.image_url || undefined,
          error: updatedMeta.error,
          completionActions: buildVideoFailureActions(updatedMeta),
        })
      }
      return NextResponse.json({ status: 'processing', snapshotId, imageUrl: snap.image_url || undefined })
    }

    // Poll provider — route by taskId prefix
    // task-unified-* = Evolink SeeDance, cgt-* = SeeDance (Volcengine), mc-* = Motion Control, xai-* = Grok, else = Kling
    const isEvolink = videoMeta.taskId.startsWith('task-unified-')
    const isSeedance = videoMeta.taskId.startsWith('cgt-')
    const isMotionControl = videoMeta.taskId.startsWith('mc-')
    const isXai = videoMeta.taskId.startsWith('xai-')
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
    } else if (isXai) {
      const { getXaiVideoTask } = await import('@/lib/xai-video')
      result = await getXaiVideoTask(videoMeta.taskId)
    } else if (provider === 'piapi') {
      result = await getKlingTaskPiAPI(videoMeta.taskId)
    } else {
      result = await getKlingTask(videoMeta.taskId)
    }

    if (result.status === 'completed' && result.videoUrl) {
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'completed', videoUrl: result.videoUrl, providerUrl: result.videoUrl }

      await admin
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

          const permanentUrl = await uploadVideo(admin, ownerUserId, projectId, snapshotId, buffer)
          if (permanentUrl) {
            const finalMeta: VideoMeta = {
              ...updatedMeta,
              videoUrl: permanentUrl,
              videoPath: `${ownerUserId}/projects/${projectId}/animation/${snapshotId}.mp4`,
              width: dims.width,
              height: dims.height,
            }
            await admin
              .from('snapshots')
              .update({ video_meta: finalMeta })
              .eq('id', snapshotId)
            console.log(`Video snapshot ${snapshotId} persisted (${dims.width}x${dims.height})`)

            // Extract poster frame and update image_url
            try {
              const { extractVideoPoster } = await import('@/lib/video-poster')
              const posterBuffer = await extractVideoPoster(permanentUrl)
              const posterPath = `${ownerUserId}/${projectId}/posters/${snapshotId}.jpg`
              const { error: posterErr } = await admin.storage.from('images').upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true })
              if (!posterErr) {
                const { data: urlData } = admin.storage.from('images').getPublicUrl(posterPath)
                if (urlData?.publicUrl) {
                  await admin.from('snapshots').update({ image_url: urlData.publicUrl }).eq('id', snapshotId)
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
      const { handleVideoFailure } = await import('@/lib/video-lifecycle')
      await handleVideoFailure(snapshotId, result.error)
      return NextResponse.json({
        status: 'failed',
        snapshotId,
        imageUrl: snap.image_url || undefined,
        error: result.error,
        completionActions: buildVideoFailureActions({ ...videoMeta, status: 'failed', error: result.error }),
      })
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
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId } = authResult.auth
    const admin = getSupabaseAdmin()

    const { snapshotId } = await params

    const { data: snap } = await admin
      .from('snapshots')
      .select('video_meta, projects(user_id)')
      .eq('id', snapshotId)
      .maybeSingle()

    const project = getProjectInfo(snap?.projects as SnapshotProject)
    if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (project?.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (snap?.video_meta) {
      const videoMeta = snap.video_meta as VideoMeta
      const updatedMeta: VideoMeta = { ...videoMeta, status: 'abandoned' }
      await admin
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
