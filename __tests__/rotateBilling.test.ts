import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getToolPrice: vi.fn(),
  requireCredits: vi.fn(),
  deductCredits: vi.fn(),
  rotateCamera: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }),
}))
vi.mock('@/lib/skills/rotate-camera', () => ({ rotateCamera: mocks.rotateCamera }))
vi.mock('@/lib/billing/credits', () => ({ requireCredits: mocks.requireCredits, deductCredits: mocks.deductCredits }))
vi.mock('@/lib/billing/pricing', () => ({
  FAL_ROTATE_CAMERA_TOOL: 'rotate_camera_fal',
  getToolPrice: mocks.getToolPrice,
}))

import { POST } from '@/app/api/rotate/route'

function request() {
  return new NextRequest('http://localhost/api/rotate', {
    method: 'POST',
    body: JSON.stringify({ image: 'data:image/png;base64,YQ==', azimuth: 90, elevation: 0, distance: 1 }),
  })
}

describe('fal camera rotation billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getToolPrice.mockResolvedValue({ credits: 7, isFree: false })
    mocks.requireCredits.mockResolvedValue({ ok: true, balance: 100 })
    mocks.rotateCamera.mockResolvedValue({ success: true, image: 'rotated-image', provider: 'fal', message: 'done' })
    mocks.deductCredits.mockResolvedValue({ charged: 7, remaining: 93 })
  })

  it('quotes and logs the fal SKU before returning an image', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).image).toBe('rotated-image')
    expect(mocks.getToolPrice).toHaveBeenCalledWith('rotate_camera_fal')
    expect(mocks.requireCredits).toHaveBeenCalledWith('user-1', 7)
    expect(mocks.deductCredits).toHaveBeenCalledWith('user-1', null, 'rotate_camera_fal', undefined, expect.any(Number))
  })

  it('does not call fal when the price is missing', async () => {
    mocks.getToolPrice.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.rotateCamera).not.toHaveBeenCalled()
  })

  it('does not charge failed generation', async () => {
    mocks.rotateCamera.mockResolvedValue({ success: false, message: 'provider rejected' })
    expect((await POST(request())).status).toBe(502)
    expect(mocks.deductCredits).not.toHaveBeenCalled()
  })

  it('withholds output when charge confirmation fails', async () => {
    mocks.deductCredits.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).image).toBeUndefined()
  })
})
