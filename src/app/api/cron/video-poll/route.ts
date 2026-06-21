import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { handleVideoFailure } from '@/lib/video-lifecycle'
import type { VideoMeta } from '@/types'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: stale } = await admin
    .from('snapshots')
    .select('id, video_meta')
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
        await admin.from('snapshots').update({
          video_meta: { ...vm, status: 'completed', videoUrl: result.videoUrl },
        }).eq('id', snap.id)
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

  return NextResponse.json({ processed, total: stale?.length || 0 })
}
