'use client'

import { useEffect, type RefObject } from 'react'

/** Updates only the native placeholder; typing never rerenders the homepage or its media. */
export function useTypewriterPlaceholder(
  ref: RefObject<HTMLTextAreaElement | null>,
  examples: readonly string[] | undefined,
  enabled: boolean,
  paused: boolean,
) {
  const content = JSON.stringify(examples ?? [])
  useEffect(() => {
    const el = ref.current
    const phrases: string[] = JSON.parse(content)
    if (!el || !phrases.length) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = false
    let index = 0
    let count = 0
    let deleting = false
    const stop = () => clearTimeout(timer)
    const tick = () => {
      const letters = Array.from(phrases[index])
      count += deleting ? -1 : 1
      el.placeholder = letters.slice(0, count).join('')
      let delay = deleting ? 30 : 65
      if (count === letters.length) { deleting = true; delay = 2600 }
      else if (count === 0) { deleting = false; index = (index + 1) % phrases.length; delay = 650 }
      timer = setTimeout(tick, delay)
    }
    const sync = () => {
      stop()
      if (document.activeElement === el || el.value) { el.placeholder = ''; return }
      if (!enabled || paused || reduced.matches) { el.placeholder = phrases[0]; return }
      if (!visible || document.hidden) return
      index = 0; count = 0; deleting = false
      el.placeholder = ''
      timer = setTimeout(tick, 650)
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    observer.observe(el)
    el.addEventListener('focus', sync)
    el.addEventListener('blur', sync)
    el.addEventListener('input', sync)
    document.addEventListener('visibilitychange', sync)
    reduced.addEventListener('change', sync)
    sync()
    return () => {
      stop(); observer.disconnect()
      el.removeEventListener('focus', sync)
      el.removeEventListener('blur', sync)
      el.removeEventListener('input', sync)
      document.removeEventListener('visibilitychange', sync)
      reduced.removeEventListener('change', sync)
    }
  }, [ref, content, enabled, paused])
}
