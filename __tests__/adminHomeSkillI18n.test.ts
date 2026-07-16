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

function request(method: 'POST' | 'PUT', body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/home-skills', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin home skill i18n contract', () => {
  const eqUpdate = vi.fn()
  const update = vi.fn()
  const singleExisting = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'admin-1' } })
    mocks.isAdmin.mockResolvedValue(true)
    eqUpdate.mockResolvedValue({ error: null })
    update.mockReturnValue({ eq: eqUpdate })
    singleExisting.mockResolvedValue({
      data: {
        labels: { en: 'English', zh: '简体', 'zh-Hant': '繁體', ja: '日本語' },
        prompts: { en: 'English prompt', zh: '简体提示', 'zh-Hant': '繁體提示', ja: '古い日本語' },
        prompt: 'English prompt',
      },
      error: null,
    })
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'home_skills') throw new Error(`Unexpected table: ${table}`)
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleExisting })) })),
          update,
        }
      }),
    })
  })

  it('merges a non-English prompt update without deleting other locales', async () => {
    const { PUT } = await import('@/app/api/admin/home-skills/route')
    const response = await PUT(request('PUT', {
      id: 'skill-1',
      prompts: { ja: '新しい日本語プロンプト' },
    }))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      prompts: {
        en: 'English prompt',
        zh: '简体提示',
        'zh-Hant': '繁體提示',
        ja: '新しい日本語プロンプト',
      },
      prompt: 'English prompt',
    }))
  })

  it('merges localized titles instead of replacing the whole object', async () => {
    const { PUT } = await import('@/app/api/admin/home-skills/route')
    const response = await PUT(request('PUT', {
      id: 'skill-1',
      labels: { ja: '新しいタイトル' },
    }))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      labels: { en: 'English', zh: '简体', 'zh-Hant': '繁體', ja: '新しいタイトル' },
    }))
  })

  it('requires all four titles and prompts when creating a skill', async () => {
    const { POST } = await import('@/app/api/admin/home-skills/route')
    const response = await POST(request('POST', {
      labels: { en: 'English', zh: '简体' },
      prompts: { en: 'Prompt' },
      image: 'https://example.com/cover.jpg',
      categories: ['photo'],
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Missing localized titles: zh-Hant, ja' })
  })

  it('requires at least one category when creating a fully localized skill', async () => {
    const { POST } = await import('@/app/api/admin/home-skills/route')
    const response = await POST(request('POST', {
      labels: { en: 'English', zh: '简体', 'zh-Hant': '繁體', ja: '日本語' },
      prompts: { en: 'Prompt', zh: '提示', 'zh-Hant': '提示', ja: 'プロンプト' },
      image: 'https://example.com/cover.jpg',
      categories: [],
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'At least one category is required' })
  })
})
