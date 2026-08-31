import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo, isPermanentUrl } from '@/lib/supabase/storage'
import type { VideoMeta } from '@/types'
import { buildVideoFailureActions } from '@/lib/artifact-actions'
import { getRemotionExportJob, runRemotionExportJob } from '@/lib/remotion-export'
import { getRequestLocale } from '@/lib/server-locale'

export const maxDuration = 1800

type SnapshotProject = { user_id?: string; is_public?: boolean } | Array<{ user_id?: string; is_public?: boolean }>

function getProjectInfo(projects: SnapshotProject | null | undefined) {
  return Array.isArray(projects) ? projects[0] : projects
}

function runRemotionExportAfterResponse(jobId: string) {
  after(async () => {
    try {
      await runRemotionExportJob(jobId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('already rendering')) {
        console.error(`[video-snapshot] Remotion export worker failed for ${jobId}:`, err)
      }
    }
  })
}

function repairVideoPosterAfterResponse(options: {
  admin: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  projectId: string
  snapshotId: string
  videoUrl: string | null | undefined
  currentImageUrl?: string | null
}) {
  after(async () => {
    const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair')
    await ensureVideoPosterForSnapshot(options)
  })
}

async function fetchProviderVideoBuffer(videoUrl: string): Promise<Uint8Array | null> {
  if (videoUrl.startsWith('https://generativelanguage.googleapis.com/') || videoUrl.startsWith('data:')) {
    const { fetchGoogleOmniVideoBytes } = await import('@/lib/google-omni-video')
    return fetchGoogleOmniVideoBytes(videoUrl)
  }
  const res = await fetch(videoUrl)
  if (!res.ok) return null
  return new Uint8Array(await res.arrayBuffer())
}

function persistProviderVideoAfterResponse(options: {
  admin: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  projectId: string
  snapshotId: string
  videoMeta: VideoMeta
  providerVideoUrl: string
  currentImageUrl?: string | null
}) {
  after(async () => {
    try {
      const buffer = await fetchProviderVideoBuffer(options.providerVideoUrl)
      if (!buffer) return

      const { probeMP4Dimensions } = await import('@/lib/mp4-probe')
      const dims = probeMP4Dimensions(buffer) || { width: 1080, height: 1920 }

      const permanentUrl = await uploadVideo(options.admin, options.ownerUserId, options.projectId, options.snapshotId, buffer)
      if (permanentUrl) {
        const finalMeta: VideoMeta = {
          ...options.videoMeta,
          status: 'completed',
          videoUrl: permanentUrl,
          providerUrl: options.providerVideoUrl,
          videoPath: `${options.ownerUserId}/projects/${options.projectId}/animation/${options.snapshotId}.mp4`,
          width: dims.width,
          height: dims.height,
        }
        await options.admin
          .from('snapshots')
          .update({ video_meta: finalMeta })
          .eq('id', options.snapshotId)
        console.log(`Video snapshot ${options.snapshotId} persisted (${dims.width}x${dims.height})`)

        const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair')
        await ensureVideoPosterForSnapshot({
          admin: options.admin,
          ownerUserId: options.ownerUserId,
          projectId: options.projectId,
          snapshotId: options.snapshotId,
          videoUrl: permanentUrl,
          currentImageUrl: options.currentImageUrl,
          videoBuffer: buffer,
        })
      }
    } catch (err) {
      console.error('Video snapshot persist error:', err)
    }
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  try {
    const { snapshotId } = await params
    const locale = getRequestLocale(req)
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
        repairVideoPosterAfterResponse({
          admin,
          ownerUserId,
          projectId: snap.project_id,
          snapshotId,
          videoUrl: videoMeta.videoUrl,
          currentImageUrl: snap.image_url,
        })
        return NextResponse.json({ status: 'completed', videoUrl: videoMeta.videoUrl, snapshotId, imageUrl: snap.image_url || undefined })
      }
      persistProviderVideoAfterResponse({
        admin,
        ownerUserId,
        projectId: snap.project_id,
        snapshotId,
        videoMeta,
        providerVideoUrl: videoMeta.videoUrl,
        currentImageUrl: snap.image_url,
      })
      // Provider URL still in DB — persist hasn't finished yet, tell caller to keep polling
      return NextResponse.json({ status: 'rendering', snapshotId, imageUrl: snap.image_url || undefined })
    }
    if (videoMeta.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        snapshotId,
        imageUrl: snap.image_url || undefined,
        error: videoMeta.error,
        completionActions: buildVideoFailureActions(videoMeta, locale),
      })
    }

    if (!videoMeta.taskId) {
      return NextResponse.json({ error: 'No task ID' }, { status: 400 })
    }

    if (videoMeta.taskId.startsWith('remotion-export-pending-') || videoMeta.taskId.startsWith('remotion-export-')) {
      const isPendingSnapshot = videoMeta.taskId.startsWith('remotion-export-pending-')
      const jobId = videoMeta.taskId.slice(
        isPendingSnapshot ? 'remotion-export-pending-'.length : 'remotion-export-'.length,
      )
      const job = await getRemotionExportJob(jobId)
      if (!job) return NextResponse.json({ status: 'processing', snapshotId, imageUrl: snap.image_url || undefined })
      if (job.status === 'completed' && job.storage_url) {
        const updatedMeta: VideoMeta = {
          ...videoMeta,
          taskId: `remotion-export-${job.id}`,
          status: 'completed',
          videoUrl: job.storage_url,
          providerUrl: job.storage_url,
          videoPath: job.workspace_path || videoMeta.videoPath,
          duration: job.duration_seconds || videoMeta.duration,
          width: job.width || videoMeta.width,
          height: job.height || videoMeta.height,
        }
        await admin.from('snapshots').update({ video_meta: updatedMeta }).eq('id', snapshotId)
        repairVideoPosterAfterResponse({
          admin,
          ownerUserId,
          projectId: snap.project_id,
          snapshotId,
          videoUrl: job.storage_url,
          currentImageUrl: snap.image_url,
        })
        return NextResponse.json({ status: 'completed', videoUrl: job.storage_url, snapshotId, imageUrl: snap.image_url || undefined })
      }
      if (job.status === 'failed') {
        const updatedMeta: VideoMeta = {
          ...videoMeta,
          taskId: `remotion-export-${job.id}`,
          status: 'failed',
          error: job.error || 'Remotion export failed',
        }
        await admin.from('snapshots').update({ video_meta: updatedMeta }).eq('id', snapshotId)
        return NextResponse.json({
          status: 'failed',
          snapshotId,
          imageUrl: snap.image_url || undefined,
          error: updatedMeta.error,
          completionActions: buildVideoFailureActions(updatedMeta, locale),
        })
      }
      runRemotionExportAfterResponse(job.id)
      return NextResponse.json({ status: 'processing', snapshotId, imageUrl: snap.image_url || undefined })
    }

    // Poll provider — route by taskId prefix
    // task-unified-* = Evolink SeeDance, mr-wan30-* = MuleRouter Wan, cgt-* = SeeDance (Volcengine), mc-* = Motion Control, xai-* = Grok, google-omni-* = Gemini Omni, minimax-h3-* = MiniMax H3, else = Kling
    const isEvolink = videoMeta.taskId.startsWith('task-unified-')
    const isMuleRouter = videoMeta.taskId.startsWith('mr-wan30-')
    const isSeedance = videoMeta.taskId.startsWith('cgt-')
    const isMotionControl = videoMeta.taskId.startsWith('mc-')
    const isXai = videoMeta.taskId.startsWith('xai-')
    const isGoogleOmni = videoMeta.taskId.startsWith('google-omni-')
    const isMinimax = videoMeta.taskId.startsWith('minimax-h3-')
    const isSyncLipsync = videoMeta.taskId.startsWith('sync3-')
    const provider = process.env.ANIMATE_PROVIDER || 'kling'
    let result: { taskId: string; status: string; videoUrl?: string; error?: string }
    const realTaskId = isMotionControl ? videoMeta.taskId.slice(3) : videoMeta.taskId

    if (isMuleRouter) {
      const { getMuleRouterVideoTask } = await import('@/lib/mulerouter-video')
      result = await getMuleRouterVideoTask(videoMeta.taskId)
    } else if (isEvolink) {
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
      result = await getXaiVideoTask(videoMeta.taskId, ownerUserId)
    } else if (isGoogleOmni) {
      if (videoMeta.taskId.startsWith('google-omni-job-') && !videoMeta.videoUrl && !videoMeta.providerUrl) {
        const {
          GOOGLE_OMNI_TIMEOUT_ERROR,
          isGoogleOmniPlaceholderExpired,
        } = await import('@/lib/google-omni-video')
        if (isGoogleOmniPlaceholderExpired(videoMeta.createdAt)) {
          const { handleVideoFailure } = await import('@/lib/video-lifecycle')
          await handleVideoFailure(snapshotId, GOOGLE_OMNI_TIMEOUT_ERROR)
          const failedMeta: VideoMeta = {
            ...videoMeta,
            status: 'failed',
            error: GOOGLE_OMNI_TIMEOUT_ERROR,
          }
          return NextResponse.json({
            status: 'failed',
            snapshotId,
            imageUrl: snap.image_url || undefined,
            error: GOOGLE_OMNI_TIMEOUT_ERROR,
            completionActions: buildVideoFailureActions(failedMeta, locale),
          })
        }
        return NextResponse.json({ status: 'processing', snapshotId, imageUrl: snap.image_url || undefined })
      }
      const { getGoogleOmniVideoTask } = await import('@/lib/google-omni-video')
      result = await getGoogleOmniVideoTask(videoMeta.taskId, videoMeta.videoUrl || videoMeta.providerUrl)
    } else if (isMinimax) {
      const { getMinimaxVideoTask } = await import('@/lib/minimax-video')
      result = await getMinimaxVideoTask(videoMeta.taskId)
    } else if (isSyncLipsync) {
      const { getSyncLipsyncTask } = await import('@/lib/sync-lipsync')
      result = await getSyncLipsyncTask(videoMeta.taskId)
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

      persistProviderVideoAfterResponse({
        admin,
        ownerUserId,
        projectId: snap.project_id,
        snapshotId,
        videoMeta: updatedMeta,
        providerVideoUrl: result.videoUrl,
        currentImageUrl: snap.image_url,
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
        completionActions: buildVideoFailureActions({ ...videoMeta, status: 'failed', error: result.error }, locale),
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
