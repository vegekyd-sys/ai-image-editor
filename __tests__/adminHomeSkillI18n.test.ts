import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  isAdmin: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}))

vi.mock('@/lib/admin', () => ({
  isAdmin: mocks.isAdmin,
}))

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/home-skills', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin home skill prompt compatibility', () => {
  const eq = vi.fn()
  const update = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'admin-1' } })
    mocks.isAdmin.mockResolvedValue(true)
    eq.mockResolvedValue({ error: null })
    update.mockReturnValue({ eq })
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
    })
  })

  it('keeps the legacy prompt unchanged when only a non-English locale is updated', async () => {
    const { PUT } = await import('@/app/api/admin/home-skills/route')
    const response = await PUT(request({
      id: 'skill-1',
      prompts: { ja: '日本語プロンプト' },
    }))

    expect(response.status).toBe(200)
    const updates = update.mock.calls[0][0]
    expect(updates.prompts).toEqual({ ja: '日本語プロンプト' })
    expect(updates).not.toHaveProperty('prompt')
  })

  it('dual-writes an English localized prompt for legacy clients', async () => {
    const { PUT } = await import('@/app/api/admin/home-skills/route')
    const response = await PUT(request({
      id: 'skill-1',
      prompts: { en: 'English prompt', ja: '日本語プロンプト' },
    }))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      prompts: { en: 'English prompt', ja: '日本語プロンプト' },
      prompt: 'English prompt',
    }))
  })
})
