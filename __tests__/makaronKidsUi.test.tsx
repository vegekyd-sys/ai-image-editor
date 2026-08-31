import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audioCallbacks: null as null | {
    onPhase: (phase: string) => void
    onTurnComplete?: (result: { hadOutput: boolean; recording: Promise<Blob | null> }) => void
  },
  liveCallbacks: null as null | { onmessage: (message: unknown) => void },
  close: vi.fn(),
  sendToolResponse: vi.fn(),
  sendClientContent: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  finishInput: vi.fn(),
  backupRecording: Promise.resolve(new Blob(['recording'], { type: 'audio/webm' })),
  operatorRespond: vi.fn(async () => '小巫师收到啦'),
  play: vi.fn(async () => undefined),
}))

vi.mock('next/image', () => ({ default: ({ alt = '', ...props }: Record<string, unknown>) => <img alt={String(alt)} {...props} /> }))
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/kids/kids-audio', () => ({
  KidsLiveAudio: class {
    constructor(callbacks: typeof mocks.audioCallbacks) { mocks.audioCallbacks = callbacks }
    async start() { mocks.audioCallbacks?.onPhase('listening') }
    async stop() {}
    finishInput() {
      mocks.finishInput()
      mocks.audioCallbacks?.onPhase('thinking')
      return mocks.backupRecording
    }
    handleMessage(message: { data?: string; serverContent?: { turnComplete?: boolean } }) {
      if (message.data) mocks.audioCallbacks?.onPhase('speaking')
      if (message.serverContent?.turnComplete) mocks.audioCallbacks?.onPhase('listening')
    }
    sendImage() {}
  },
}))
vi.mock('@/components/kids/kids-turn-audio', () => ({
  KidsTurnAudio: class {
    startRecording = mocks.startRecording
    stopRecording = mocks.stopRecording
    cancel() {}
    play = mocks.play
  },
}))
vi.mock('@/components/kids/kids-operator', () => ({
  KidsOperatorHandoff: class {
    respond = mocks.operatorRespond
    queue() { return false }
    resetSource() {}
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
    mocks.backupRecording = Promise.resolve(new Blob(['recording'], { type: 'audio/webm' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'kids.finishTalking' }))
    expect(mocks.finishInput).toHaveBeenCalledOnce()
    expect(mocks.close).not.toHaveBeenCalled()
    expect(stage.getAttribute('data-phase')).toBe('thinking')

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

  it('turns a public-page 401 into a parent sign-in state instead of a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    const { container } = render(<MakaronKids />)

    fireEvent.click(screen.getByRole('button', { name: 'kids.startTalking' }))

    await waitFor(() => expect(container.querySelector('main')?.getAttribute('data-phase')).toBe('parent'))
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'kids.parent.signIn' }).getAttribute('href')).toBe('/login?next=%2Fkids')
  })

  it('starts the compatible recorder when Live token provisioning is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'provider unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })))
    const { container } = render(<MakaronKids />)

    fireEvent.click(screen.getByRole('button', { name: 'kids.startTalking' }))

    await waitFor(() => expect(container.querySelector('main')?.getAttribute('data-phase')).toBe('recording'))
    expect(mocks.startRecording).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'kids.finishTalking' })).not.toBeNull()
  })

  it('reuses the same recording through the compatible path when Live returns an empty turn', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'token', model: 'gemini-3.1-flash-live-preview',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: '画一只小猫' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob(['voice'], { type: 'audio/mpeg' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<MakaronKids />)

    fireEvent.click(screen.getByRole('button', { name: 'kids.startTalking' }))
    await waitFor(() => expect(container.querySelector('main')?.getAttribute('data-phase')).toBe('listening'))
    act(() => mocks.audioCallbacks?.onTurnComplete?.({
      hadOutput: false,
      recording: Promise.resolve(new Blob(['recording'], { type: 'audio/webm' })),
    }))

    await waitFor(() => expect(mocks.operatorRespond).toHaveBeenCalledWith('画一只小猫', null))
    await waitFor(() => expect(mocks.play).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/kids/transcribe')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/kids/speak')
  })

  it('uses the backup recording when Live never sends a turn-complete event', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'token', model: 'gemini-3.1-flash-live-preview',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: '火箭飞去月亮' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob(['voice'], { type: 'audio/mpeg' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<MakaronKids />)

    fireEvent.click(screen.getByRole('button', { name: 'kids.startTalking' }))
    await waitFor(() => expect(container.querySelector('main')?.getAttribute('data-phase')).toBe('listening'))
    fireEvent.click(screen.getByRole('button', { name: 'kids.finishTalking' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })

    await waitFor(() => expect(mocks.operatorRespond).toHaveBeenCalledWith('火箭飞去月亮', null))
    await waitFor(() => expect(mocks.play).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/kids/transcribe')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/kids/speak')
    vi.useRealTimers()
  })
})
