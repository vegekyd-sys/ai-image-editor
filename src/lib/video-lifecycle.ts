import { getSupabaseAdmin } from '@/lib/supabase/service'

/**
 * Handle video generation failure — atomically mark failed + refund credits.
 * Safe to call from any path (frontend poll, CLI poll, cron).
 * Returns true if this call actually processed the failure (first caller wins).
 */
export async function handleVideoFailure(snapshotId: string, error?: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { data, error: rpcError } = await admin.rpc('fail_video_snapshot_and_refund', {
    p_snapshot_id: snapshotId,
    p_error: error || null,
  })

  if (rpcError) {
    throw new Error(`Video failure refund failed: ${rpcError.message}`)
  }

  const result = Array.isArray(data) ? data[0] : data
  if (result?.processed && Number(result.refunded_credits) > 0) {
    console.log(`[refund] video ${snapshotId} failed, refunded ${result.refunded_credits} reserved credits`)
  }
  return result?.processed === true
}
