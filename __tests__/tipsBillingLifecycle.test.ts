import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ generate: vi.fn(), debit: vi.fn(), fixed: vi.fn(), after: [] as (() => Promise<void>)[] }))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: (work: () => Promise<void>) => h.after.push(work) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
} }) }))
vi.mock('@/lib/gemini', () => ({ streamTipsByCategory: h.generate, ContentBlockedError: class extends Error {} }))
vi.mock('@/lib/workspace', () => ({ getSkill: vi.fn() }))
vi.mock('@/lib/billing/credits', () => ({ requireCredits: async () => ({ ok: true }),
  deductByTokens: h.debit, deductCredits: h.fixed }))
import { POST } from '@/app/api/tips/route'

beforeEach(() => { vi.resetAllMocks(); h.after.length = 0 })

function request() {
  return new NextRequest('http://localhost/api/tips', { method: 'POST',
    body: JSON.stringify({ image: 'data:image/png;base64,YQ==', category: 'enhance' }) })
}

describe('Tips billing lifecycle', () => {
  it.each([true, false])('closes the stream immediately and keeps token billing=%s alive through after()', async tokens => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    h.debit.mockReturnValue(pending); h.fixed.mockReturnValue(pending)
    h.generate.mockImplementation(async function* (...args: unknown[]) {
      if (tokens) Object.assign(args[7] as object, { inputTokens: 100, outputTokens: 10, model: 'test:text' })
      yield { label: 'A tip' }
    })
    const response = await POST(request())
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('A tip')
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('[DONE]')
    expect((await reader.read()).done).toBe(true)
    expect(h.after).toHaveLength(1)
    let settled = false
    const background = h.after[0]().then(() => { settled = true })
    await Promise.resolve(); await Promise.resolve()
    expect(settled).toBe(false)
    expect(tokens ? h.debit : h.fixed).toHaveBeenCalledTimes(1)
    expect(tokens ? h.fixed : h.debit).not.toHaveBeenCalled()
    finish()
    await background
    expect(settled).toBe(true)
    expect(h.generate).toHaveBeenCalledTimes(1)
  })

  it('logs an eventual billing failure once, closes, and never regenerates or falls back to a debit', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.generate.mockImplementation(async function* (...args: unknown[]) {
      Object.assign(args[7] as object, { inputTokens: 100, outputTokens: 10, model: 'test:text' })
      yield { label: 'A tip' }
    })
    h.debit.mockRejectedValue(new Error('pricing read unavailable'))
    try {
      const response = await POST(request())
      expect(await response.text()).toContain('[DONE]')
      await h.after[0]()
      expect(h.debit).toHaveBeenCalledTimes(1)
      expect(h.fixed).not.toHaveBeenCalled()
      expect(h.generate).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledTimes(1)
    } finally { log.mockRestore() }
  })
  it('keeps final usage and billing alive after the client cancels mid-stream', async () => {
    let resume!: () => void
    const paused = new Promise<void>(resolve => { resume = resolve })
    h.generate.mockImplementation(async function* (...args: unknown[]) {
      yield { label: 'First tip' }
      await paused
      Object.assign(args[7] as object, { inputTokens: 100, outputTokens: 10, model: 'test:text' })
      yield { label: 'Final tip' }
    })
    h.debit.mockResolvedValue({ charged: 1 })
    const response = await POST(request())
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    let finished = false
    const background = h.after[0]().then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(h.debit).not.toHaveBeenCalled()
    resume()
    await background
    expect(h.debit).toHaveBeenCalledExactlyOnceWith('user-1', 'tips', 'test:text', 100, 10)
    expect(h.fixed).not.toHaveBeenCalled()
    expect(h.generate).toHaveBeenCalledTimes(1)
  })

})
