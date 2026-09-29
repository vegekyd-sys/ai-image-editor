import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import heroPreviews from '@/lib/home-hero-previews.json'
import type { HomeSkill } from '@/lib/home-skills'

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({ locale: 'en', t: (key: string) => key }),
  pickLocalizedValue: () => 'Example',
}))
vi.mock('@/components/HomeSkillMedia', () => ({
  LazyVideo: ({ suspended, paused }: { suspended: boolean; paused: boolean }) => (
    suspended ? <img alt="" /> : <video data-playing={!paused} />
  ),
}))
import HomeCreativeHero from '@/components/HomeCreativeHero'

let intersection: IntersectionObserverCallback
const skills = Object.entries(heroPreviews).map(([id, value]) => ({
  id, image: value.source, labels: { en: 'Example' }, before_images: [],
})) as unknown as HomeSkill[]
let mobile = true
beforeEach(() => {
  mobile = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const visible = (isIntersecting: boolean) => act(() => intersection([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver))
const props = { skills, paused: false, suspended: false, onSelect: vi.fn() }

it('keeps mobile artwork visible with at most one live video and pauses it for overlays and typing', () => {
  const view = render(<HomeCreativeHero {...props}><textarea aria-label="Prompt" /></HomeCreativeHero>)
  visible(true)
  expect(view.container.querySelectorAll('video')).toHaveLength(1)
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(1)
  view.rerender(<HomeCreativeHero {...props} paused><textarea aria-label="Prompt" /></HomeCreativeHero>)
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(0)
  // Pause retains the player and its decoded frame rather than recreating it.
  expect(view.container.querySelectorAll('video')).toHaveLength(1)
  view.rerender(<HomeCreativeHero {...props}><textarea aria-label="Prompt" /></HomeCreativeHero>)
  act(() => view.getByRole('textbox').focus())
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(0)
  act(() => view.getByRole('textbox').blur())
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(1)
})

it('stops desktop artwork offscreen and in background tabs, then resumes visible playback', () => {
  mobile = false
  const view = render(<HomeCreativeHero {...props}>Content</HomeCreativeHero>)
  visible(true)
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(2)
  visible(false)
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(0)
  visible(true)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(0)
  hidden.mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  expect(view.container.querySelectorAll('video[data-playing="true"]')).toHaveLength(2)
})
