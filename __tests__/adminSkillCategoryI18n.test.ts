import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  isAdmin: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }))

describe('admin skill category i18n updates', () => {
  const update = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'admin-1' } })
    mocks.isAdmin.mockResolvedValue(true)
    update.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'portrait' }, error: null }) })),
      })),
    })
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                labels: { en: 'Portrait', zh: '人像', 'zh-Hant': '人像', ja: 'ポートレート' },
                descriptions: { en: 'Portrait effects', ja: 'ポートレート効果' },
              },
              error: null,
            }),
          })),
        })),
        update,
      })),
    })
  })

  it('merges partial category labels and descriptions', async () => {
    const { PUT } = await import('@/app/api/admin/skill-categories/route')
    const response = await PUT(new NextRequest('http://localhost/api/admin/skill-categories', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'portrait',
        labels: { ja: '人物写真' },
        descriptions: { zh: '人像效果' },
      }),
    }))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      labels: { en: 'Portrait', zh: '人像', 'zh-Hant': '人像', ja: '人物写真' },
      descriptions: { en: 'Portrait effects', zh: '人像效果', ja: 'ポートレート効果' },
    }))
  })
})
