import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LiquidGlassNav from '@/components/LiquidGlassNav'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  prefetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({ locale: 'en' }),
}))

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: () => false,
}))

vi.mock('@/lib/native-app-cache', () => ({
  warmNativeJSONCache: vi.fn(),
}))

vi.mock('@/lib/home-skills-warm', () => ({
  warmHomeSkillsCache: vi.fn(),
}))

vi.mock('@/lib/projects-list-warm', () => ({
  warmProjectsListCache: vi.fn(),
}))

describe('LiquidGlassNav surface transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: undefined,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({ finished: Promise.resolve() })),
    })
    mocks.push.mockImplementation(() => {
      document.querySelector('[data-makaron-surface="explore"]')
        ?.setAttribute('data-makaron-surface', 'projects')
    })
  })

  it('keeps shared elements alive through the manual fallback and cleans up afterward', async () => {
    render(
      <main data-makaron-surface="explore">
        <div className="mkr-surface-brand">Makaron</div>
        <div className="mkr-surface-composer">Create</div>
        <LiquidGlassNav active="explore" />
      </main>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))

    expect(mocks.push).toHaveBeenCalledWith('/projects')
    expect(document.querySelector('[data-makaron-surface="projects"]')).toBeTruthy()

    await waitFor(() => {
      expect(document.querySelectorAll('.mkr-surface-transition-ghost')).toHaveLength(0)
      expect(document.documentElement.dataset.makaronSurfaceTransition).toBeUndefined()
      expect(document.querySelectorAll('.mkr-surface-shared-hidden')).toHaveLength(0)
    })
  })
})
