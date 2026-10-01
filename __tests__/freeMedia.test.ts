// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'

const m = vi.hoisted(() => ({ result: vi.fn(), auth: vi.fn(), rpc: vi.fn(), eq: vi.fn(), gt: vi.fn(), or: vi.fn() }))
vi.mock('@/lib/free-media-policy', () => ({ FREE_MEDIA_ENABLED: true }))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: m.auth }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: () => {
  const query = { select: () => query, eq: (...args: unknown[]) => {m.eq(...args);return query;},
    gt: (...args: unknown[]) => {m.gt(...args);return query;}, in: () => query,
    or: (...args: unknown[]) => {m.or(...args);return query;}, limit: m.result }
  return query
} }) }))
vi.mock('@/lib/billing/welcome-credits', () => ({ getConfiguredWelcomeCredits: async () => 500 }))
import { GET } from '../src/app/api/media/unlock/route'
import { initializeSignupCredits } from '../src/lib/billing/signup-credits'

const owner = '12345678-1234-1234-1234-123456789012'
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  m.result.mockResolvedValue({ data: [], error: null })
  m.auth.mockResolvedValue({ auth: { userId: owner } })
})

describe('web download entitlement', () => {
  const request = () => new Request('https://app.test/api/media/unlock')
  it.each([true, false])('returns paid=%s without processing or returning media', async paid => {
    m.result.mockResolvedValue({ data: paid ? [{ id: 'purchase' }] : [], error: null })
    const response = await GET(request())
    expect(await response.json()).toEqual({ paid })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(m.eq).toHaveBeenCalledWith('user_id', owner)
    expect(m.eq).toHaveBeenCalledWith('status', 'completed')
    expect(m.gt).toHaveBeenCalledWith('amount_usd', 0)
    expect(m.or).toHaveBeenCalledWith('provider.eq.stripe,and(provider.eq.apple,apple_environment.eq.Production)')
  })
  it('does not grant clean access on an authentication or database failure', async () => {
    m.auth.mockResolvedValueOnce({ error: new Response('Unauthorized', { status: 401 }) })
    expect((await GET(request())).status).toBe(401)
    expect(m.result).not.toHaveBeenCalled()
    m.result.mockResolvedValueOnce({ data: null, error: new Error('DB unavailable') })
    expect((await GET(request())).status).toBe(503)
  })
  it('allows Xcode purchases only with an explicit isolated local acceptance switch', async () => {
    vi.stubEnv('MAKARON_E2E_APPLE_MEDIA_ACCESS', '1')
    vi.stubEnv('MAKARON_E2E', '1')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55321')
    m.result.mockResolvedValue({ data: [{ id: 'xcode-purchase' }], error: null })
    expect(await (await GET(request())).json()).toEqual({ paid: true })
    expect(m.or).toHaveBeenCalledWith('provider.eq.stripe,and(provider.eq.apple,apple_environment.in.(Production,Xcode,LocalTesting))')
  })
  it.each([
    ['1', 'https://cdn.makaron.app'],
    ['0', 'http://127.0.0.1:55321'],
  ])('rejects local acceptance outside isolation (%s, %s)', async (e2e, url) => {
    vi.stubEnv('MAKARON_E2E_APPLE_MEDIA_ACCESS', '1')
    vi.stubEnv('MAKARON_E2E', e2e)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url)
    expect((await GET(request())).status).toBe(503)
    expect(m.result).not.toHaveBeenCalled()
  })
  it('accepts verified positive Sandbox purchases only on an opted-in Preview', async () => {
    vi.stubEnv('MAKARON_PREVIEW_APPLE_MEDIA_ACCESS', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    m.result.mockResolvedValue({ data: [{ id: 'sandbox-purchase' }], error: null })
    expect(await (await GET(request())).json()).toEqual({ paid: true })
    expect(m.or).toHaveBeenCalledWith('provider.eq.stripe,and(provider.eq.apple,apple_environment.in.(Production,Sandbox))')
    expect(m.eq).toHaveBeenCalledWith('status', 'completed');expect(m.gt).toHaveBeenCalledWith('amount_usd', 0)
  })
  it.each(['production', 'development', undefined])('fails closed if Sandbox media opt-in reaches %s', async environment => {
    vi.stubEnv('MAKARON_PREVIEW_APPLE_MEDIA_ACCESS', '1')
    vi.stubEnv('VERCEL_ENV', environment)
    expect((await GET(request())).status).toBe(503);expect(m.result).not.toHaveBeenCalled()
  })
})

describe('free signup quota', () => {
  it.each([true, false])('grants the same credits without trial gating (iOS=%s)', async isIOSApp => {
    m.rpc.mockResolvedValue({ data: { granted: true, credits: 500 }, error: null })
    const result = await initializeSignupCredits({ userId: owner, isIOSApp, admin: { rpc: m.rpc } as never })
    expect(result).toEqual({ credits: 500, trialRequired: false })
    expect(m.rpc).toHaveBeenCalledWith('claim_welcome_credits', { p_user_id: owner, p_credits: 500, p_channel: isIOSApp ? 'ios_signup' : 'web_signup' })
  })
  it('does not grant again when the atomic claim was already used', async () => {
    m.rpc.mockResolvedValue({ data: { granted: false }, error: null })
    expect((await initializeSignupCredits({ userId: owner, isIOSApp: true, admin: { rpc: m.rpc } as never })).credits).toBe(0)
  })
})
