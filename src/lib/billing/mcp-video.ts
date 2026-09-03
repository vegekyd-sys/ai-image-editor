import { createHash, randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { createVideo, type CreateVideoInput, type CreateVideoResult } from '@/lib/skills/create-video'
import { getVideoStatus } from '@/lib/skills/get-video-status'
import { isGrokSubscriptionAllowedUser } from '@/lib/grok-subscription'
import { normalizeVideoModelId } from '@/lib/video-model-capabilities'
import { isBillingEnabled, recordSubscriptionUsage, requireCredits } from './credits'
import { quoteVideo, type VideoQuoteInput } from './media-pricing'

export interface McpVideoOwner { userId: string; apiKeyId: string; toolName: string }

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await getSupabaseAdmin().rpc(name, args)
  if (error) throw new Error(`Video billing: ${error.message}`)
  return data
}

/** Reservation state is per tool call, never shared by concurrent calls on an MCP server. */
export async function submitMcpVideo(input: CreateVideoInput, owner: McpVideoOwner): Promise<CreateVideoResult> {
  if (input.motionControl) throw new Error('Hosted MCP motion-control pricing is not configured.')
  const requestId = input.billingRequestId ?? randomUUID()
  // The returned ID must be reusable even when the first call omitted it.
  // Normalize top-level key order so equivalent requests hash identically.
  const parameters = Object.fromEntries(Object.entries({ ...input, userId: owner.userId, toolName: owner.toolName })
    .filter(([key, value]) => key !== 'billingRequestId' && typeof value !== 'function')
    .sort(([left], [right]) => left.localeCompare(right)))
  const fingerprint = createHash('sha256').update(JSON.stringify(parameters)).digest('hex')
  if (input.billingRequestId) {
    const { data: previous, error } = await getSupabaseAdmin().from('mcp_video_reservations')
      .select('fingerprint,task_id,status').eq('id', requestId).eq('user_id', owner.userId).maybeSingle()
    if (error) throw new Error('Cannot verify prior billing request. Retry with the same request ID.')
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('Billing request conflict: parameters changed.')
      return { success: Boolean(previous.task_id), taskId: previous.task_id ?? undefined,
        retryable: false,
        message: previous.task_id ? `Existing video task: ${previous.task_id}` : `Request ${requestId}: ${previous.status}. Do not create another provider job.` }
    }
  }
  const subscription = normalizeVideoModelId(input.videoModel) === 'grok' && await isGrokSubscriptionAllowedUser(owner.userId)
  let usage: VideoQuoteInput | undefined
  let reserved = false
  let replay: CreateVideoResult | undefined
  const reserve = async () => {
    if (reserved || !(await isBillingEnabled())) return
    if (!usage) throw new Error('Resolved video usage is required before paid API submission.')
    const quote = await quoteVideo(usage)
    const balance = await requireCredits(owner.userId, quote.credits)
    if (!balance.ok) throw new Error(`Insufficient credits: need ${quote.credits}, have ${balance.balance}.`)
    const row = await rpc('reserve_mcp_video', {
      p_id: requestId, p_user_id: owner.userId, p_api_key_id: owner.apiKeyId,
      p_tool: owner.toolName, p_model: normalizeVideoModelId(input.videoModel),
      p_fingerprint: fingerprint, p_quote: quote,
    })
    if (!row.created) {
      replay = {
        success: Boolean(row.task_id), taskId: row.task_id ?? undefined,
        retryable: false,
        message: row.task_id ? `Existing video task: ${row.task_id}` : `Request ${requestId} already exists (${row.status}); do not resubmit the provider job.`,
      }
      throw new Error('Existing billing request')
    }
    reserved = true
  }
  const result = await createVideo({
    ...input, userId: owner.userId,
    onBeforeProviderSubmit: async resolved => { usage = resolved; if (!subscription) await reserve() },
    onBeforeGrokApiFallback: reserve,
  }).catch((error): CreateVideoResult => ({ success: false, submissionUncertain: true, message: error instanceof Error ? error.message : String(error) }))
  if (replay) return replay
  if (reserved) {
    try {
      await rpc('finish_mcp_video_submission', {
        p_id: requestId, p_user_id: owner.userId, p_task_id: result.taskId ?? null,
        p_state: result.success && result.taskId
          ? result.status === 'completed' && result.videoUrl ? 'completed' : 'submitted'
          : result.submissionUncertain ? 'uncertain' : 'refunded',
      })
    } catch (error) {
      console.error('[billing] MCP submission reconciliation required', { requestId, taskId: result.taskId, error })
      // Preserve the provider receipt; a bookkeeping error must not encourage
      // the client to submit and pay for a duplicate generation.
      return { ...result, retryable: false, message: `${result.message}\nBilling reconciliation required. Request: ${requestId}. Do not resubmit this job.` }
    }
  } else if (result.success && result.provider === 'grok-subscription') {
    await recordSubscriptionUsage(owner.userId, 'grok-subscription', owner.toolName, 'grok', { apiKeyId: owner.apiKeyId })
  }
  if (reserved && result.submissionUncertain && !result.taskId) {
    return { ...result, retryable: false, errorCode: 'SUBMISSION_UNCERTAIN',
      message: `${result.message}\nProvider submission is unconfirmed. Credits remain reserved pending reconciliation. Billing request: ${requestId}. Do not submit another generation; retry only with this same billingRequestId to check its receipt.` }
  }
  return { ...result, message: `${result.message}\nBilling request: ${requestId}` }
}

/** Only confirmed provider failure is refundable; a poll transport error isn't failure. */
export async function settleMcpVideoStatus(userId: string, taskId: string, status: string, queryFailed = false): Promise<void> {
  if (queryFailed || !['completed', 'failed'].includes(status)) return
  await rpc('settle_mcp_video', { p_user_id: userId, p_task_id: taskId, p_failed: status === 'failed' })
}

/** Settle submitted jobs even when the client stops polling. */
export async function reconcileMcpVideos(): Promise<number> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('mcp_video_reservations')
    .select('id,user_id,task_id').eq('status', 'submitted')
    .lt('last_checked_at', new Date(Date.now() - 30_000).toISOString())
    .order('last_checked_at').limit(10)
  if (error) throw new Error('MCP billing reconciliation query failed')
  const results = await Promise.all((data ?? []).map(async row => {
    try {
      const result = await getVideoStatus({ taskId: row.task_id, userId: row.user_id })
      await settleMcpVideoStatus(row.user_id, row.task_id, result.status, result.queryFailed)
      const update = await admin.from('mcp_video_reservations').update({ last_checked_at: new Date().toISOString() }).eq('id', row.id)
      if (update.error) throw update.error
      return result.queryFailed ? 0 : 1
    } catch (error) {
      console.error('[billing] MCP video reconciliation failed', { requestId: row.id, error })
      return 0
    }
  }))
  return results.reduce<number>((sum, value) => sum + value, 0)
}
