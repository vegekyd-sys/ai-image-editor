import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequireAuth } from '@/hooks/useRequireAuth'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: true }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: mocks.getSession } }),
}))

function Harness() {
  const requireAuth = useRequireAuth()
  return <button type="button" onClick={() => void requireAuth()}>Continue</button>
}

describe('useRequireAuth first interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/home')
  })

  it('uses one session read instead of polling auth state for two seconds', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/login?next=%2Fhome'))
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('mkr_return_url')).toBe('/home')
  })

  it('carries a Skill template destination in the login URL as well as storage', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState({}, '', '/home?skill=world-cup-mvp')
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(
      '/login?next=%2Fhome%3Fskill%3Dworld-cup-mvp',
    ))
    expect(sessionStorage.getItem('mkr_return_url')).toBe('/home?skill=world-cup-mvp')
    expect(localStorage.getItem('mkr_return_url')).toBe('/home?skill=world-cup-mvp')
  })
})
