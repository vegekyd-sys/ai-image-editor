interface HomeComposerViewportInsetOptions {
  isDesktop: boolean
  textareaFocused: boolean
  keyboardInset: number
}

/**
 * Safari can keep a stale visualViewport height after the keyboard closes or
 * the page returns from the background. Never move the composer with that
 * value unless one of its textareas is actually focused.
 */
export function getHomeComposerViewportInset({
  isDesktop,
  textareaFocused,
  keyboardInset,
}: HomeComposerViewportInsetOptions): number {
  if (isDesktop || !textareaFocused) return 0
  return Math.max(0, Math.round(keyboardInset))
}
