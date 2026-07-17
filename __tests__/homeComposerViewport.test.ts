import { describe, expect, it } from 'vitest'
import { getHomeComposerViewportInset } from '@/lib/home-composer-viewport'

describe('home skill composer viewport inset', () => {
  it('ignores a stale Safari keyboard inset after the textarea loses focus', () => {
    expect(getHomeComposerViewportInset({
      isDesktop: false,
      textareaFocused: false,
      keyboardInset: 594,
    })).toBe(0)
  })

  it('keeps the focused mobile composer above the software keyboard', () => {
    expect(getHomeComposerViewportInset({
      isDesktop: false,
      textareaFocused: true,
      keyboardInset: 318.4,
    })).toBe(318)
  })

  it('does not apply a mobile keyboard inset on desktop', () => {
    expect(getHomeComposerViewportInset({
      isDesktop: true,
      textareaFocused: true,
      keyboardInset: 318,
    })).toBe(0)
  })
})
