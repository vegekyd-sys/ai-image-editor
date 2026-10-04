import { describe, expect, it, vi } from 'vitest'
import { readAgentAwareSource } from './helpers/agentRuntimeSource'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ rpc: mockRpc }),
}))

const root = process.cwd()
const read = (file: string) => readAgentAwareSource(root, file)

describe('video credit reservation contract', () => {
  it('reserves the estimated video price before provider submission', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')
    const animateRoute = read('src/app/api/animate/route.ts')
    const agent = read('src/lib/agent.ts')

    expect(snapshotRoute).not.toContain('requireCredits(userId, 50)')
    expect(animateRoute).not.toContain('requireCredits(user.id, 50)')
    expect(snapshotRoute.indexOf('reserveFixedCredits(userId, creditsRequired,'))
      .toBeLessThan(snapshotRoute.indexOf('const skillResult = await createVideo'))
    expect(animateRoute.indexOf('requireCredits(user.id, creditsRequired)'))
      .toBeLessThan(animateRoute.indexOf('const skillResult = await createVideo'))
    expect(agent.indexOf('requireCredits(ctx.userId, creditsRequired)'))
      .toBeLessThan(agent.indexOf('const skillResult = isGoogleOmniAsync'))
  })

  it('keeps the App snapshot reservation on the one-RPC fast path', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')
    const credits = read('src/lib/billing/credits.ts')

    expect(snapshotRoute).not.toContain('requireCredits(userId, creditsRequired)')
    expect(snapshotRoute).toContain('reserveFixedCredits(userId, creditsRequired')
    expect(credits).toContain('return await deductFixedCredits(userId, credits, toolName')
    expect(credits.indexOf('return await deductFixedCredits(userId, credits, toolName'))
      .toBeLessThan(credits.indexOf('const creditCheck = await requireCredits(userId, credits)'))
  })

  it('uses one atomic database RPC for sort allocation and video snapshot insertion', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')
    const migration = read('supabase/migrations/20260902122747_optimize_video_snapshot_submission.sql')

    expect(snapshotRoute).toContain("supabase.rpc('insert_video_snapshot_atomic'")
    expect(migration).toContain('SECURITY INVOKER')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('INSERT INTO public.snapshots')
    expect(migration).toContain('TO authenticated, service_role')
    expect(snapshotRoute).toContain(".select('id, type, video_meta, image_url, sort_order')")
    expect(snapshotRoute).not.toContain("supabase.rpc('next_sort_order'")
  })

  it('publishes per-stage Server-Timing for real submission benchmarks', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')

    expect(snapshotRoute).toContain("response.headers.set('Server-Timing'")
    for (const metric of ['auth', 'preflight_db', 'billing', 'provider_submit', 'persist', 'total']) {
      expect(snapshotRoute).toContain(`${metric}:`)
    }
  })

  it('stores only the successful reservation as refundable snapshot metadata', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')
    const agent = read('src/lib/agent.ts')

    expect(snapshotRoute).toContain('creditsCharged: reservedCredits')
    expect(agent).toContain('creditsCharged: reservedVideoCredits')
    expect(snapshotRoute).not.toContain('videoMeta.creditsCharged = creditsRequired')
    expect(agent).not.toContain('videoMeta.creditsCharged = creditsRequired')
  })

  it('uses atomic no-overdraft debit and idempotent snapshot failure refund SQL', () => {
    const migration = read('supabase/migrations/20260724123316_prevent_video_credit_overrefund.sql')
    const repairMigration = read('supabase/migrations/20260728140000_fix_video_failure_lifecycle.sql')
    const overloadCleanupMigration = read('supabase/migrations/20260808155126_drop_obsolete_video_failure_rpc_overload.sql')

    expect(migration).toContain('AND balance >= p_amount')
    expect(migration).toContain("RAISE EXCEPTION 'insufficient_credits:")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION fail_video_snapshot_and_refund')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain("<> 'processing'")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION fail_video_snapshot_and_refund')
    expect(migration).toContain('TO service_role')
    expect(repairMigration).toContain('DROP FUNCTION IF EXISTS fail_video_snapshot_and_refund(UUID, TEXT)')
    expect(repairMigration).toContain('p_snapshot_id TEXT')
    expect(repairMigration).toContain('GRANT EXECUTE ON FUNCTION fail_video_snapshot_and_refund(TEXT, TEXT)')
    expect(overloadCleanupMigration).toContain(
      'DROP FUNCTION IF EXISTS public.fail_video_snapshot_and_refund(UUID, TEXT)',
    )
    expect(overloadCleanupMigration).toContain(
      "to_regprocedure('public.fail_video_snapshot_and_refund(text,text)')",
    )
  })

  it('keeps stale Google Omni placeholders terminal and cron polling isolated', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/[snapshotId]/route.ts')
    const videoPollCron = read('src/app/api/cron/video-poll/route.ts')
    const googleOmni = read('src/lib/google-omni-video.ts')

    expect(googleOmni).toContain('GOOGLE_OMNI_REQUEST_TIMEOUT_MS')
    expect(googleOmni).toContain('AbortSignal.timeout(GOOGLE_OMNI_REQUEST_TIMEOUT_MS)')
    expect(snapshotRoute).toContain('isGoogleOmniPlaceholderExpired')
    expect(snapshotRoute).toContain('GOOGLE_OMNI_TIMEOUT_ERROR')
    expect(videoPollCron).toContain("vm.taskId.startsWith('google-omni-')")
    expect(videoPollCron).toContain('tryHandleVideoFailure')
    expect(read('src/lib/agent.ts')).toContain('[google-omni] snapshot job crashed:')
  })
})

describe('video failure lifecycle', () => {
  it('delegates transition and refund to one database transaction', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ processed: true, refunded_credits: 322, remaining_balance: 415 }],
      error: null,
    })

    const { handleVideoFailure } = await import('@/lib/video-lifecycle')
    await expect(handleVideoFailure('snapshot-1', 'provider failed')).resolves.toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('fail_video_snapshot_and_refund', {
      p_snapshot_id: 'snapshot-1',
      p_error: 'provider failed',
    })
  })

  it('treats a repeated poller as an idempotent no-op', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ processed: false, refunded_credits: 0, remaining_balance: null }],
      error: null,
    })

    const { handleVideoFailure } = await import('@/lib/video-lifecycle')
    await expect(handleVideoFailure('snapshot-1', 'provider failed')).resolves.toBe(false)
  })
})
