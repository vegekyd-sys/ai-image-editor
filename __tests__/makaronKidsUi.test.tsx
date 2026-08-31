import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audioCallbacks: null as null | { onPhase: (phase: string) => void },
  liveCallbacks: null as null | { onmessage: (message: unknown) => void },
  close: vi.fn(),
  sendToolResponse: vi.fn(),
  sendClientContent: vi.fn(),
}))

vi.mock('next/image', () => ({ default: ({ alt = '', ...props }: Record<string, unknown>) => <img alt={String(alt)} {...props} /> }))
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/kids/kids-audio', () => ({
  KidsLiveAudio: class {
    constructor(callbacks: typeof mocks.audioCallbacks) { mocks.audioCallbacks = callbacks }
    async start() { mocks.audioCallbacks?.onPhase('listening') }
    async stop() {}
    handleMessage(message: { data?: string; serverContent?: { turnComplete?: boolean } }) {
      if (message.data) mocks.audioCallbacks?.onPhase('speaking')
      if (message.serverContent?.turnComplete) mocks.audioCallbacks?.onPhase('listening')
    }
    sendImage() {}
  },
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: vi.fn(async ({ callbacks }) => {
      mocks.liveCallbacks = callbacks
      return { close: mocks.close, sendToolResponse: mocks.sendToolResponse, sendClientContent: mocks.sendClientContent }
    }) }
  },
  Modality: { AUDIO: 'AUDIO' },
}))

import MakaronKids from '@/components/kids/MakaronKids'

describe('Makaron Kids UI state and parent accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.audioCallbacks = null
    mocks.liveCallbacks = null
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'token', model: 'gemini-3.1-flash-live-preview',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  it('moves through connecting, listening, speaking, and stopped states', async () => {
    const { container } = render(<MakaronKids />)
    const stage = container.querySelector('main')!
    const mic = screen.getByRole('button', { name: 'kids.startTalking' })

    fireEvent.click(mic)
    expect(stage.getAttribute('data-phase')).toBe('connecting')
    await waitFor(() => expect(stage.getAttribute('data-phase')).toBe('listening'))

    act(() => mocks.liveCallbacks?.onmessage({ data: 'AA==' }))
    expect(stage.getAttribute('data-phase')).toBe('speaking')
    fireEvent.click(screen.getByRole('button', { name: 'kids.stopTalking' }))
    await waitFor(() => expect(stage.getAttribute('data-phase')).toBe('idle'))
  })

  it('opens the parent gate by keyboard or long hold, focuses close, and closes with Escape', async () => {
    vi.useFakeTimers()
    const gate = render(<MakaronKids />).getByRole('button', { name: 'kids.parent.hold' })

    fireEvent.keyDown(gate, { key: 'Enter' })
    const close = screen.getByRole('button', { name: 'kids.parent.close' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(gate)

    fireEvent.pointerDown(gate, { pointerId: 1 })
    act(() => vi.advanceTimersByTime(900))
    expect(screen.getByRole('dialog')).not.toBeNull()
    vi.useRealTimers()
  })
})
