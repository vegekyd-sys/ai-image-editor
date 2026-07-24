import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/auth/complete/route'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  cookies: vi.fn(),
  from: vi.fn(),
  getConfiguredWelcomeCredits: vi.fn(),
  addCredits: vi.fn(),
  sendMetaCapiEvent: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}))
vi.mock('@/lib/billing/welcome-credits', () => ({
  getConfiguredWelcomeCredits: mocks.getConfiguredWelcomeCredits,
}))
vi.mock('@/lib/billing/credits', () => ({ addCredits: mocks.addCredits }))
vi.mock('@/lib/marketing/meta-capi', () => ({
  readAttributionCookie: () => ({}),
  sendMetaCapiEvent: mocks.sendMetaCapiEvent,
}))

function mockAdminState(options: { activated: boolean; hasBalance: boolean }) {
  const upsert = vi.fn(async () => ({ error: null }))
  const insert = vi.fn(async () => ({ error: null }))
  mocks.from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => table === 'user_profiles'
          ? { data: options.activated ? { activated: true } : null }
          : { data: options.hasBalance ? { balance: 500 } : null },
      }),
    }),
    upsert,
    insert,
  }))
  return { upsert, insert }
}

describe('verified authentication completion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookies.mockResolvedValue({
      getAll: () => [],
      set: vi.fn(),
    })
    mocks.getConfiguredWelcomeCredits.mockResolvedValue(500)
    mocks.addCredits.mockResolvedValue(undefined)
    mocks.sendMetaCapiEvent.mockResolvedValue(undefined)
  })

  it('activates a verified new user, grants configured credits, and writes the cookie', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'new-user',
          email: 'new@example.test',
          email_confirmed_at: '2026-07-21T00:00:00Z',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    })
    const { upsert, insert } = mockAdminState({ activated: false, hasBalance: false })

    const response = await POST(new NextRequest('http://localhost:3001/api/auth/complete', { method: 'POST' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, isNewUser: true, credits: 500 })
    expect(response.cookies.get('mkr_activated')?.value).toBe('1')
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-user', activated: true }), { onConflict: 'id' })
    expect(mocks.addCredits).toHaveBeenCalledWith('new-user', 500)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ credits: 500, source: 'welcome' }))
    expect(mocks.sendMetaCapiEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps completion idempotent for an already activated user', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'existing-user',
          email: 'existing@example.test',
          email_confirmed_at: '2026-07-21T00:00:00Z',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    })
    const { upsert, insert } = mockAdminState({ activated: true, hasBalance: true })

    const response = await POST(new NextRequest('http://localhost:3001/api/auth/complete', { method: 'POST' }))
    const body = await response.json()

    expect(body).toMatchObject({ ok: true, isNewUser: false, credits: 0, redirectUrl: '/projects' })
    expect(response.cookies.get('mkr_activated')?.value).toBe('1')
    expect(upsert).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.addCredits).not.toHaveBeenCalled()
  })

  it('rejects an authenticated but unverified session', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'unverified-user', email_confirmed_at: null, phone_confirmed_at: null } },
      error: null,
    })

    const response = await POST(new NextRequest('http://localhost:3001/api/auth/complete', { method: 'POST' }))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(response.cookies.get('mkr_activated')).toBeUndefined()
  })

  it('rejects an external GET return target after completing an existing session', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'existing-user',
          email_confirmed_at: '2026-07-21T00:00:00Z',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    })
    mockAdminState({ activated: true, hasBalance: true })

    const response = await GET(new NextRequest(
      'http://localhost:3001/api/auth/complete?next=https%3A%2F%2Fevil.example%2Fsteal',
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3001/projects')
  })
})
