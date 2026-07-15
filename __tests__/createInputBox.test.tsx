import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateInputBox from '@/components/CreateInputBox'
import { useCreateInput } from '@/hooks/useCreateInput'

function touchMove(target: HTMLElement, x: number, y: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: [{ clientX: x, clientY: y }],
  })
  target.dispatchEvent(event)
}

function frontCard(el: HTMLElement) {
  const card = Array.from(el.children).find((child) => (child as HTMLElement).style.zIndex === '3')
  if (!card) throw new Error('front card not found')
  return card as HTMLElement
}

function CreateInputHarness() {
  const input = useCreateInput()

  useEffect(() => {
    void input.addFiles([
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.jpg', { type: 'image/jpeg' }),
      new File(['three'], 'three.jpg', { type: 'image/jpeg' }),
    ])

  }, [])

  return (
    <CreateInputBox
      input={input}
      slotWidth={80}
      isDesktop={false}
      onSubmit={vi.fn()}
      skills={[]}
      selectedSkill={null}
      onSkillChange={vi.fn()}
    />
  )
}

function EmptyCreateInputHarness({
  onSubmit,
  submitWhenEmpty = false,
  actionMode = false,
  fallbackHref,
}: {
  onSubmit: () => void
  submitWhenEmpty?: boolean
  actionMode?: boolean
  fallbackHref?: string
}) {
  const input = useCreateInput()

  return (
    <CreateInputBox
      input={input}
      slotWidth={80}
      isDesktop={false}
      actionMode={actionMode}
      submitWhenEmpty={submitWhenEmpty}
      fallbackHref={fallbackHref}
      onSubmit={onSubmit}
      skills={[]}
      selectedSkill={null}
      onSkillChange={vi.fn()}
    />
  )
}

describe('CreateInputBox', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
  })

  it('keeps mobile multi-upload card swiping working without a parent swipeRef', async () => {
    render(<CreateInputHarness />)

    const stack = await waitFor(() => {
      const el = screen.getByTestId('mobile-upload-swipe-stack')
      expect(el.getAttribute('data-count')).toBe('3')
      expect(el.getAttribute('data-idx')).toBe('2')
      return el
    })

    fireEvent.touchStart(stack, { touches: [{ clientX: 160, clientY: 40 }] })
    touchMove(stack, 70, 42)

    await waitFor(() => {
      expect(frontCard(stack).style.transform).toContain('translateX(-90px)')
    })

    fireEvent.touchEnd(stack)

    await waitFor(() => {
      expect(stack.getAttribute('data-idx')).toBe('0')
    })
  })

  it('can submit the primary action even when the input is empty', () => {
    const onSubmit = vi.fn()
    render(<EmptyCreateInputHarness onSubmit={onSubmit} submitWhenEmpty />)

    fireEvent.click(screen.getByTestId('create-project'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps an empty guest CTA on native navigation without a hydrated touch/click interception', () => {
    const onSubmit = vi.fn()
    render(<EmptyCreateInputHarness onSubmit={onSubmit} submitWhenEmpty fallbackHref="/login" />)

    const cta = screen.getByRole('link')
    expect(cta.getAttribute('href')).toBe('/login')

    let preventedByReact: boolean | null = null
    const observeDefault = (event: Event) => {
      preventedByReact = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', observeDefault, { once: true })
    fireEvent.click(cta)

    expect(preventedByReact).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits action-mode primary CTA on the first touch without a duplicate click', () => {
    const onSubmit = vi.fn()
    render(<EmptyCreateInputHarness onSubmit={onSubmit} submitWhenEmpty actionMode />)

    const cta = screen.getByTestId('create-project')
    fireEvent.touchStart(cta, { touches: [{ clientX: 120, clientY: 40 }] })
    fireEvent.click(cta)

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
