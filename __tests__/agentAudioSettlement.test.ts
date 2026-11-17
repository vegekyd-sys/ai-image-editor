// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { createTools, type AgentContext } from '@/lib/agent-tools'
import { sanitizeToolHistory } from '@/lib/agentToolHistory'
import { InsufficientCreditsError } from '@/lib/billing/credits'

const deps = vi.hoisted(() => ({ check: vi.fn(), debit: vi.fn(), generate: vi.fn() }))
vi.mock('@/lib/billing/credits', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/billing/credits')>(),
  isBillingEnabled: async () => true, requireCredits: deps.check, deductFixedCredits: deps.debit,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { seededMediaPrices } = await import('./helpers/media-prices')
  return { getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ order: async () => ({ data: seededMediaPrices(), error: null }) }) }),
  }) }
})
vi.mock('@/lib/skills/create-audio', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/skills/create-audio')>(), createAudio: deps.generate,
}))

const usage = { provider: 'evolink', model: 'evolink-seed-audio', durationSeconds: 30, providerCreditsUsed: 6.12 }
const request = { kind: 'music', prompt: 'Piano theme', duration_seconds: 30 }
function generate() {
  const ctx: AgentContext = {
    userId: 'fixture', projectId: 'fixture', currentImage: '', snapshotImages: [], currentSnapshotIndex: -1,
    explicitMediaIndices: [], generatedImages: [], isNsfw: false,
  }
  const tool = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_audio
  return (tool.execute as any)(request, { messages: [] })
}

beforeEach(() => {
  vi.resetAllMocks()
  deps.check.mockResolvedValue({ ok: true, balance: 17 })
  deps.generate.mockResolvedValue({ success: true, provider: 'evolink', taskId: 'original-task',
    message: 'Audio ready', audioUrl: 'https://example.com/track.wav', duration: 30, trackIndex: 1, billing: usage })
})

it('declines an unaffordable estimate before generating audio', async () => {
  deps.check.mockResolvedValue({ ok: false, balance: 14 })
  expect(await generate()).toMatchObject({ success: false })
  expect(deps.check).toHaveBeenCalledWith('fixture', 15)
  expect(deps.generate).not.toHaveBeenCalled()
  expect(deps.debit).not.toHaveBeenCalled()
})

it.each([
  [new InsufficientCreditsError(17, 18), { status: 'insufficient_credits', required: 18, balance: 17 }],
  [new Error('RPC disconnected'), { status: 'unconfirmed' }],
])('preserves generated audio and a reconciliation receipt after debit failure', async (error, expected) => {
  deps.debit.mockRejectedValue(error)
  const result = await generate()
  const { output } = sanitizeToolHistory('generate_audio', request, result, { rows: 0, chars: 0 })
  expect(output).toMatchObject({ type: 'json', value: {
    success: true, taskId: 'original-task', audioUrl: 'https://example.com/track.wav',
    trackIndex: 1, audioSettlement: { ...expected, usage },
  } })
  expect(deps.debit).toHaveBeenCalledTimes(1)
  expect(deps.generate).toHaveBeenCalledTimes(1)
})

it('records the actual charge when the full debit succeeds', async () => {
  deps.debit.mockResolvedValue({ charged: 18, remaining: 3 })
  expect(await generate()).toMatchObject({ success: true, audioSettlement: { status: 'settled', charged: 18 } })
  expect(deps.debit).toHaveBeenCalledWith('fixture', 18, 'create_seed_audio', usage.model, undefined, null)
})
