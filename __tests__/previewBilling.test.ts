import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateLite: vi.fn(),
  requireCredits: vi.fn(),
  deductByTokens: vi.fn(),
  deductCredits: vi.fn(),
  getToolPrice: vi.fn(),
  getTokenRate: vi.fn(),
  isBillingEnabled: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) } }),
}))
vi.mock('@/lib/model-router', () => ({ generateImage: mocks.generateImage }))
vi.mock('@/lib/gemini', () => ({ generateTipsPreviewImageOpenRouter: mocks.generateLite }))
vi.mock('@/lib/billing/credits', () => ({
  requireCredits: mocks.requireCredits,
  deductByTokens: mocks.deductByTokens,
  deductCredits: mocks.deductCredits,
  isBillingEnabled: mocks.isBillingEnabled,
}))
vi.mock('@/lib/billing/token-rates', () => ({ getTokenRate: mocks.getTokenRate }))
vi.mock('@/lib/billing/pricing', () => ({ getToolPrice: mocks.getToolPrice }))

import { POST } from '@/app/api/preview/route'

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/preview', {
    method: 'POST',
    body: JSON.stringify({ image: 'data:image/png;base64,YQ==', editPrompt: 'Edit the image', ...extra }),
  })
}

describe('Tips preview billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MOCK_AI
    mocks.getToolPrice.mockImplementation(async (name: string) => ({
      credits: name === 'edit_image_qwen-spicy' ? 8 : 2,
      isFree: false,
    }))
    mocks.requireCredits.mockResolvedValue({ ok: true, balance: 100 })
    mocks.generateLite.mockResolvedValue({ image: null })
    mocks.generateImage.mockResolvedValue({ image: 'spicy-image', model: 'qwen-spicy', fallbackUsed: false })
    mocks.deductCredits.mockResolvedValue({ charged: 8, remaining: 92 })
    mocks.deductByTokens.mockResolvedValue({ charged: 2, remaining: 98 })
    mocks.isBillingEnabled.mockResolvedValue(true)
  })

  it.each([
    { category: 'enhance' },
    { isNsfw: true },
  ])('quotes Spicy and bypasses Lite for $category', async fields => {
    const response = await POST(request(fields))
    expect(response.status).toBe(200)
    expect((await response.json()).image).toBe('spicy-image')
    expect(mocks.getToolPrice).toHaveBeenCalledWith('edit_image_qwen-spicy')
    expect(mocks.requireCredits).toHaveBeenCalledWith('user-1', 8)
    expect(mocks.generateLite).not.toHaveBeenCalled()
    expect(mocks.deductCredits).toHaveBeenCalledWith('user-1', null, 'edit_image_qwen-spicy')
  })

  it('checks the Spicy price again before a Lite failure can fall back to it', async () => {
    mocks.requireCredits.mockResolvedValueOnce({ ok: true, balance: 2 })
      .mockResolvedValueOnce({ ok: false, balance: 2, response: Response.json({ error: 'insufficient_credits' }, { status: 402 }) })
    const response = await POST(request({ category: 'creative' }))
    expect(response.status).toBe(402)
    expect(mocks.requireCredits.mock.calls.map(call => call[1])).toEqual([2, 8])
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.deductCredits).not.toHaveBeenCalled()
  })

  it('does not return a paid image when the debit or usage log fails', async () => {
    mocks.deductCredits.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(request({ category: 'enhance' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'billing_reconciliation_required' })
  })

  it('charges Lite token usage before returning its image', async () => {
    mocks.generateLite.mockResolvedValue({
      image: 'lite-image',
      usage: { modelId: 'google/gemini-3.1-flash-lite-image', inputTokens: 10, outputTokens: 20 },
    })
    const response = await POST(request({ category: 'creative' }))
    expect(response.status).toBe(200)
    expect(mocks.requireCredits).toHaveBeenCalledOnce()
    expect(mocks.deductByTokens).toHaveBeenCalledOnce()
    expect(mocks.generateImage).not.toHaveBeenCalled()
  })

  it('fails closed when Spicy has no price', async () => {
    mocks.getToolPrice.mockResolvedValue(null)
    const response = await POST(request({ category: 'enhance' }))
    expect(response.status).toBe(503)
    expect(mocks.generateImage).not.toHaveBeenCalled()
  })

  it('does not charge when no image or token usage was returned', async () => {
    mocks.generateImage.mockResolvedValue({ image: null, model: 'qwen-spicy', fallbackUsed: false })
    const response = await POST(request({ category: 'enhance' }))
    expect(response.status).toBe(500)
    expect(mocks.deductCredits).not.toHaveBeenCalled()
    expect(mocks.deductByTokens).not.toHaveBeenCalled()
  })
})
