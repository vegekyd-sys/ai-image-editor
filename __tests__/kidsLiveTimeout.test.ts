import { describe, expect, it, vi } from 'vitest'
import { connectKidsLiveWithTimeout } from '@/components/kids/kids-live-timeout'

describe('Makaron Kids Live connection timeout', () => {
  it('returns a timely connection unchanged', async () => {
    const session = { close: vi.fn() }
    await expect(connectKidsLiveWithTimeout(Promise.resolve(session), 20)).resolves.toBe(session)
    expect(session.close).not.toHaveBeenCalled()
  })

  it('falls back on timeout and closes a session that arrives late', async () => {
    vi.useFakeTimers()
    let resolveConnection!: (session: { close: () => void }) => void
    const connection = new Promise<{ close: () => void }>((resolve) => { resolveConnection = resolve })
    const result = connectKidsLiveWithTimeout(connection, 20)
    const rejection = expect(result).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(20)
    await rejection

    const close = vi.fn()
    const lateSession = { close }
    resolveConnection(lateSession)
    await Promise.resolve()
    expect(close).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
