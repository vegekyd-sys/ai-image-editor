import { getSupabaseAdmin } from '@/lib/supabase/service'
import { refundCredits } from '@/lib/billing/credits'
import type { VideoMeta } from '@/types'

/**
 * Handle video generation failure — atomically mark failed + refund credits.
 * Safe to call from any path (frontend poll, CLI poll, cron).
 * Returns true if this call actually processed the failure (first caller wins).
 */
export async function handleVideoFailure(snapshotId: string, error?: string): Promise<boolean> {
  const admin = getSupabaseAdmin()

  // Re-read fresh state to prevent double-processing
  const { data: snap } = await admin
    .from('snapshots')
    .select('video_meta, project_id')
    .eq('id', snapshotId)
    .single()

  const vm = snap?.video_meta as VideoMeta | null
  if (!vm || vm.status !== 'processing') return false

  // Mark failed + refunded atomically
  const updatedMeta: VideoMeta = {
    ...vm,
    status: 'failed',
    error: error || undefined,
    refunded: !!vm.creditsCharged,
  }
  await admin.from('snapshots').update({ video_meta: updatedMeta }).eq('id', snapshotId)

  // Refund if charged
  if (vm.creditsCharged && snap?.project_id) {
    const { data: proj } = await admin
      .from('projects')
      .select('user_id')
      .eq('id', snap.project_id)
      .single()
    if (proj?.user_id) {
      await refundCredits(proj.user_id, vm.creditsCharged, 'create_video')
      console.log(`[refund] video ${snapshotId} failed, refunded ${vm.creditsCharged} credits to ${proj.user_id}`)
    }
  }

  return true
}
