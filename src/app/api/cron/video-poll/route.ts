import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { handleVideoFailure } from '@/lib/video-lifecycle'
import type { VideoMeta } from '@/types'

export const maxDuration = 1800

type SnapshotProject = { user_id?: string } | Array<{ user_id?: string }>

function getProjectInfo(projects: SnapshotProject | null | undefined) {
  return Array.isArray(projects) ? projects[0] : projects
}

function getPublishedSnapshotIds(metadata: Record<string, unknown> | null | undefined): string[] {
  if (!metadata) return []
  if (Array.isArray(metadata.publishedSnapshotIds)) {
    return metadata.publishedSnapshotIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  }
  return typeof metadata.publishedSnapshotId === 'string' && metadata.publishedSnapshotId
    ? [metadata.publishedSnapshotId]
    : []
}

async function tryHandleVideoFailure(snapshotId: string, error?: string): Promise<boolean> {
  try {
    return await handleVideoFailure(snapshotId, error)
  } catch (failureError) {
    console.error(`[cron/video-poll] Failed to persist terminal state for ${snapshotId}:`, failureError)
    return false
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: stale } = await admin
    .from('snapshots')
    .select('id, project_id, image_url, video_meta, created_at, projects(user_id)')
    .eq('type', 'video')
    .lt('created_at', tenMinAgo)
    .filter('video_meta->>status', 'eq', 'processing')
    .order('created_at', { ascending: true })
    .limit(20)

  let processed = 0
  for (const snap of stale || []) {
    const vm = snap.video_meta as VideoMeta
    if (!vm?.taskId) continue
    const ownerUserId = getProjectInfo(snap.projects as SnapshotProject)?.user_id
    const createdAt = vm.createdAt || snap.created_at
    const createdAtMs = new Date(createdAt).getTime()
    const age = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0

    try {
      let result: { status: string; videoUrl?: string; error?: string }

      if (vm.taskId.startsWith('task-unified-')) {
        const { getEvolinkTask } = await import('@/lib/evolink')
        result = await getEvolinkTask(vm.taskId)
      } else if (vm.taskId.startsWith('cgt-')) {
        const { getSeedanceTask } = await import('@/lib/seedance')
        result = await getSeedanceTask(vm.taskId)
      } else if (vm.taskId.startsWith('mc-')) {
        const { getKlingMotionControlTask } = await import('@/lib/kling')
        result = await getKlingMotionControlTask(vm.taskId.slice(3))
      } else if (vm.taskId.startsWith('xai-')) {
        const { getXaiVideoTask } = await import('@/lib/xai-video')
        result = await getXaiVideoTask(vm.taskId, ownerUserId)
      } else if (vm.taskId.startsWith('google-omni-')) {
        const { getGoogleOmniVideoTask } = await import('@/lib/google-omni-video')
        result = await getGoogleOmniVideoTask(vm.taskId, vm.videoUrl || vm.providerUrl)
      } else if (vm.taskId.startsWith('minimax-h3-')) {
        const { getMinimaxVideoTask } = await import('@/lib/minimax-video')
        result = await getMinimaxVideoTask(vm.taskId)
      } else if (vm.taskId.startsWith('sync3-')) {
        const { getSyncLipsyncTask } = await import('@/lib/sync-lipsync')
        result = await getSyncLipsyncTask(vm.taskId)
      } else {
        const { getKlingTask } = await import('@/lib/kling')
        result = await getKlingTask(vm.taskId)
      }

      if (result.status === 'failed') {
        if (await tryHandleVideoFailure(snap.id, result.error)) processed++
      } else if (result.status === 'completed' && result.videoUrl) {
        const updatedMeta = { ...vm, status: 'completed' as const, videoUrl: result.videoUrl, providerUrl: result.videoUrl }
        await admin.from('snapshots').update({
          video_meta: updatedMeta,
        }).eq('id', snap.id)
        if (ownerUserId) {
          const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair')
          await ensureVideoPosterForSnapshot({
            admin,
            ownerUserId,
            projectId: snap.project_id,
            snapshotId: snap.id,
            videoUrl: result.videoUrl,
            currentImageUrl: snap.image_url,
          })
        }
        processed++
      }
      // still processing after 30min → mark timeout
      if (result.status !== 'completed' && result.status !== 'failed' && age > 30 * 60 * 1000) {
        if (await tryHandleVideoFailure(snap.id, 'Timed out after 30 minutes')) processed++
      }
    } catch (e) {
      console.error(`[cron/video-poll] Error polling ${snap.id}:`, e)
      if (age > 30 * 60 * 1000) {
        if (await tryHandleVideoFailure(snap.id, 'Provider polling failed after 30 minutes')) processed++
      }
    }
  }

  let remotionProcessed = 0
  let remotionError: string | undefined
  try {
    const { runNextRemotionExportJob } = await import('@/lib/remotion-export')
    const remotionResult = await runNextRemotionExportJob()
    if (remotionResult) {
      remotionProcessed = 1
      const { job } = remotionResult
      const publishedSnapshotIds = job.output_type === 'video' && job.publish && job.storage_url
        ? getPublishedSnapshotIds(job.metadata)
        : []
      if (publishedSnapshotIds.length > 0) {
        const { data: snapshots } = await admin
          .from('snapshots')
          .select('id, image_url')
          .in('id', publishedSnapshotIds)
        const currentImages = new Map((snapshots || []).map((snap) => [snap.id, snap.image_url]))
        const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair')
        for (const snapshotId of publishedSnapshotIds) {
          await ensureVideoPosterForSnapshot({
            admin,
            ownerUserId: job.user_id,
            projectId: job.project_id,
            snapshotId,
            videoUrl: job.storage_url,
            currentImageUrl: currentImages.get(snapshotId),
          })
        }
      }
    }
  } catch (err) {
    remotionError = err instanceof Error ? err.message : String(err)
    console.error('[cron/video-poll] Error running Remotion export worker:', err)
  }

  return NextResponse.json({
    processed,
    total: stale?.length || 0,
    remotionProcessed,
    ...(remotionError ? { remotionError } : {}),
  })
}
