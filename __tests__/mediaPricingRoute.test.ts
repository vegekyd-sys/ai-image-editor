import { beforeEach, expect, it, vi } from 'vitest'
import { seededMediaPrices } from './helpers/media-prices'
const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), query: vi.fn(), prices: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mock.auth }))
vi.mock('@/lib/admin', () => ({ isAdmin: mock.admin }))
vi.mock('@/lib/billing/media-pricing', () => ({ getMediaPrices: mock.prices }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: () => ({ update: mock.update }) }) }))
import { GET, PUT } from '@/app/api/admin/media-pricing/route'

beforeEach(() => {
  vi.resetAllMocks()
  mock.auth.mockResolvedValue({ auth: { userId: 'admin' } })
  mock.admin.mockResolvedValue(true)
  mock.prices.mockResolvedValue(seededMediaPrices())
  const chain = { eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: mock.query }
  mock.update.mockReturnValue(chain)
  mock.query.mockResolvedValue({ data: seededMediaPrices()[0], error: null })
})
const req = (body: unknown) => new Request('http://localhost/api/admin/media-pricing', { method: 'PUT', body: JSON.stringify(body) })
function edit() {
  const { id, updated_at, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier, is_active } = seededMediaPrices()[0]
  return { id, updated_at, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier, is_active }
}
it('rejects non-admin reads and writes before accessing pricing', async () => {
  mock.admin.mockResolvedValue(false)
  expect((await GET(req({}))).status).toBe(403)
  expect((await PUT(req(edit()))).status).toBe(403)
  expect(mock.prices).not.toHaveBeenCalled()
  expect(mock.update).not.toHaveBeenCalled()
})
it('validates negative prices and omitted fields', async () => {
  expect((await PUT(req({ ...edit(), output_usd_per_second: -1 }))).status).toBe(400)
  expect((await PUT(req({ id: 'partial' }))).status).toBe(400)
  expect(mock.update).not.toHaveBeenCalled()
})
it('returns conflict when the original price version changed', async () => {
  mock.query.mockResolvedValue({ data: null, error: null })
  expect((await PUT(req(edit()))).status).toBe(409)
})
it('returns the saved row and does not cache the Admin catalog', async () => {
  expect((await PUT(req(edit()))).status).toBe(200)
  const response = await GET(req({}))
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect((await response.json()).length).toBe(65)
})
