import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder'

let intersect: (entries: { isIntersecting: boolean }[]) => void
let reduced = false
function Example() {
  const ref = useRef<HTMLTextAreaElement>(null)
  useTypewriterPlaceholder(ref, ['First idea', 'Second idea'], true, false)
  return <textarea ref={ref} aria-label="Creative instructions" />
}
beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('types, holds, deletes, then cycles without changing the input value', () => {
  const { getByRole } = render(<Example />)
  const el = getByRole('textbox') as HTMLTextAreaElement
  act(() => intersect([{ isIntersecting: true }]))
  act(() => vi.advanceTimersByTime(780))
  expect(el.placeholder.length).toBeGreaterThan(0)
  expect(el.placeholder.length).toBeLessThan('First idea'.length)
  act(() => vi.advanceTimersByTime(800))
  expect(el.placeholder).toBe('First idea')
  act(() => vi.advanceTimersByTime(2800))
  expect(el.placeholder).toBe('')
  act(() => vi.advanceTimersByTime(1200))
  expect(el.placeholder).toBe('Second idea')
  expect(el.value).toBe('')
  expect(el.getAttribute('aria-label')).toBe('Creative instructions')
})
it('hides immediately on focus, stops offscreen and cleans timers on unmount', () => {
  const { getByRole, unmount } = render(<Example />)
  const el = getByRole('textbox') as HTMLTextAreaElement
  act(() => intersect([{ isIntersecting: true }]))
  act(() => vi.advanceTimersByTime(1000))
  act(() => el.focus())
  expect(el.placeholder).toBe('')
  expect(vi.getTimerCount()).toBe(0)
  fireEvent.input(el, { target: { value: 'My own idea' } })
  act(() => el.blur())
  expect(el.value).toBe('My own idea')
  expect(el.placeholder).toBe('')
  fireEvent.input(el, { target: { value: '' } })
  act(() => intersect([{ isIntersecting: false }]))
  expect(vi.getTimerCount()).toBe(0)
  act(() => intersect([{ isIntersecting: true }]))
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
it('shows a complete static suggestion when reduced motion is enabled', () => {
  reduced = true
  const { getByRole } = render(<Example />)
  act(() => intersect([{ isIntersecting: true }]))
  expect((getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('First idea')
  expect(vi.getTimerCount()).toBe(0)
})
