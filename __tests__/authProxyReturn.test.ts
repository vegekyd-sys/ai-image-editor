import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: mocks.getSession,
    },
  }),
}))

describe('authenticated login return routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'existing-user' } } },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns an existing email user to the Skill template instead of projects', async () => {
    const request = new NextRequest(
      'http://localhost:3001/login?next=%2Fhome%2F00f126ac-7451-4ee6-8025-e67dcc7b0169',
      { headers: { cookie: 'mkr_activated=1' } },
    )

    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3001/home/00f126ac-7451-4ee6-8025-e67dcc7b0169',
    )
  })

  it('rejects an external next target and keeps the normal projects fallback', async () => {
    const request = new NextRequest(
      'http://localhost:3001/login?next=https%3A%2F%2Fevil.example%2Fsteal',
      { headers: { cookie: 'mkr_activated=1' } },
    )

    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3001/projects')
  })
})
