import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ rpc: mockRpc }),
}))

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('video credit reservation contract', () => {
  it('reserves the estimated video price before provider submission', () => {
    const snapshotRoute = read('src/app/api/video-snapshot/route.ts')
    const animateRoute = read('src/app/api/animate/route.ts')
    const agent = read('src/lib/agent.ts')

    expect(snapshotRoute).not.toContain('requireCredits(userId, 50)')
    expect(animateRoute).not.toContain('requireCredits(user.id, 50)')
    expect(snapshotRoute.indexOf('requireCredits(userId, creditsRequired)'))
      .toBeLessThan(snapshotRoute.indexOf('const skillResult = await createVideo'))
    expect(animateRoute.indexOf('requireCredits(user.id, creditsRequired)'))
      .toBeLessThan(animateRoute.indexOf('const skillResult = await createVideo'))
    expect(agent.indexOf('requireCredits(ctx.userId, creditsRequired)'))
      .toBeLessThan(agent.indexOf('const skillResult = isGoogleOmniAsync'))
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
