import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { handleVideoFailure } from '@/lib/video-lifecycle'
import type { VideoMeta } from '@/types'

export const maxDuration = 800

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

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: stale } = await admin
    .from('snapshots')
    .select('id, project_id, image_url, video_meta, projects(user_id)')
    .eq('type', 'video')
    .lt('created_at', tenMinAgo)
    .filter('video_meta->>status', 'eq', 'processing')
    .limit(20)

  let processed = 0
  for (const snap of stale || []) {
    const vm = snap.video_meta as VideoMeta
    if (!vm?.taskId) continue

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
        result = await getXaiVideoTask(vm.taskId)
      } else {
        const { getKlingTask } = await import('@/lib/kling')
        result = await getKlingTask(vm.taskId)
      }

      if (result.status === 'failed') {
        await handleVideoFailure(snap.id, result.error)
        processed++
      } else if (result.status === 'completed' && result.videoUrl) {
        const updatedMeta = { ...vm, status: 'completed' as const, videoUrl: result.videoUrl, providerUrl: result.videoUrl }
        await admin.from('snapshots').update({
          video_meta: updatedMeta,
        }).eq('id', snap.id)
        const ownerUserId = getProjectInfo(snap.projects as SnapshotProject)?.user_id
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
      const age = Date.now() - new Date(vm.createdAt || '').getTime()
      if (result.status !== 'completed' && result.status !== 'failed' && age > 30 * 60 * 1000) {
        await handleVideoFailure(snap.id, 'Timed out after 30 minutes')
        processed++
      }
    } catch (e) {
      console.error(`[cron/video-poll] Error polling ${snap.id}:`, e)
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
