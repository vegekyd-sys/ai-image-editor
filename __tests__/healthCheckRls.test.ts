import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../src/app/api/cron/health-check/route'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: mocks.admin }))

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.stubEnv('MULEROUTER_API_KEY', 'synthetic')
  vi.stubEnv('FAL_KEY', 'synthetic')
  mocks.insert.mockReset().mockResolvedValue({ error: null })
  mocks.from.mockReset().mockReturnValue({ insert: mocks.insert })
  mocks.admin.mockReset().mockReturnValue({ from: mocks.from })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
const request = (authorization = 'Bearer test-secret') => new Request('http://localhost/api/cron/health-check', { headers: { authorization } })

describe('health-check under server-only RLS', () => {
  it('rejects invalid cron authorization before creating privileged client', async () => {
    vi.stubEnv('FAL_KEY', '')
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('fails closed when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', undefined)
    expect((await GET(request('Bearer undefined'))).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('fails closed for a whitespace secret', async () => {
    vi.stubEnv('CRON_SECRET', '   ')
    expect((await GET(request('Bearer    '))).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('avoids database writes when all providers are configured', async () => {
    expect((await (await GET(request())).json()).unhealthy).toBe(0)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('persists each failed health result using the service client', async () => {
    vi.stubEnv('FAL_KEY', '')
    vi.stubEnv('MULEROUTER_API_KEY', '')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).unhealthy).toBe(2)
    expect(mocks.admin).toHaveBeenCalledOnce()
    expect(mocks.from.mock.calls).toEqual([['health_alerts'], ['health_alerts']])
    expect(mocks.insert.mock.calls.map(c => c[0].service)).toEqual(['mulerouter_image_key', 'fal_rotation_key'])
  })
  it('reports returned PostgREST persistence errors without leaking details', async () => {
    vi.stubEnv('FAL_KEY', '')
    mocks.insert.mockResolvedValue({ error: { message: 'synthetic private database error', code: '42501' } })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).unhealthy).toBe(1)
    expect(console.error).toHaveBeenCalledWith('[health-check] Failed to persist health alerts')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('synthetic private database error')
  })
  it('retains the health result if privileged-client initialization throws', async () => {
    vi.stubEnv('FAL_KEY', '')
    mocks.admin.mockImplementation(() => { throw new Error('synthetic config failure') })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).unhealthy).toBe(1)
    expect(console.error).toHaveBeenCalledWith('[health-check] Failed to persist health alerts')
  })
})
