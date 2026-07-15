import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LiquidGlassNav from '@/components/LiquidGlassNav'
import TopBar from '@/components/TopBar'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  prefetch: vi.fn(),
  warmProjectsListCache: vi.fn(),
  hydrated: true,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}))

vi.mock('@/hooks/useHydrated', () => ({
  useHydrated: () => mocks.hydrated,
}))

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({ locale: 'zh', setLocale: vi.fn(), t: (key: string) => key }),
}))

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: () => false,
}))

vi.mock('@/lib/native-app-cache', () => ({
  readNativeJSONCache: () => null,
  warmNativeJSONCache: vi.fn(),
  writeNativeJSONCache: vi.fn(),
}))

vi.mock('@/lib/home-skills-warm', () => ({
  warmHomeSkillsCache: vi.fn(),
}))

vi.mock('@/lib/projects-list-warm', () => ({
  warmProjectsListCache: mocks.warmProjectsListCache,
}))

vi.mock('@/lib/native-page-stack', () => ({
  requestNativePageStackPush: vi.fn(),
}))

describe('first interaction navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hydrated = true
  })

  it('keeps native href navigation available before hydration', () => {
    mocks.hydrated = false
    render(<LiquidGlassNav active="explore" requireAuth={false} />)

    expect(screen.getByRole('link', { name: '探索' }).getAttribute('href')).toBe('/home')
    const projects = screen.getByRole('link', { name: '项目' })
    expect(projects.getAttribute('href')).toBe('/projects')

    let preventedByReact: boolean | null = null
    const observeDefault = (event: Event) => {
      preventedByReact = event.defaultPrevented
      event.preventDefault() // Keep jsdom on the current page after observing React.
    }
    document.addEventListener('click', observeDefault, { once: true })
    fireEvent.click(projects)

    expect(preventedByReact).toBe(false)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('uses client navigation after hydration so media caches survive route switches', () => {
    render(<LiquidGlassNav active="explore" requireAuth={false} />)

    const projects = screen.getByRole('link', { name: '项目' })
    let preventedByReact: boolean | null = null
    document.addEventListener('click', (event) => {
      preventedByReact = event.defaultPrevented
    }, { once: true })

    fireEvent.click(projects)

    expect(preventedByReact).toBe(true)
    expect(mocks.push).toHaveBeenCalledTimes(1)
    expect(mocks.push).toHaveBeenCalledWith('/projects')
  })

  it('leaves modified clicks to the browser after hydration', () => {
    render(<LiquidGlassNav active="explore" requireAuth={false} />)

    const projects = screen.getByRole('link', { name: '项目' })
    let preventedByReact: boolean | null = null
    const observeDefault = (event: Event) => {
      preventedByReact = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', observeDefault, { once: true })

    fireEvent.click(projects, { metaKey: true })

    expect(preventedByReact).toBe(false)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('keeps Sign in usable as a native link before hydration', () => {
    render(<TopBar page="home" />)

    const signIn = screen.getByRole('link', { name: '登录' })
    expect(signIn.getAttribute('href')).toBe('/login')

    let preventedByReact: boolean | null = null
    const observeDefault = (event: Event) => {
      preventedByReact = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', observeDefault, { once: true })
    fireEvent.click(signIn)

    expect(preventedByReact).toBe(false)
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
