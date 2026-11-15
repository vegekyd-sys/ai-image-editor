import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ generate: vi.fn(), debit: vi.fn(), fixed: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
} }) }))
vi.mock('@/lib/gemini', () => ({ streamTipsByCategory: h.generate, ContentBlockedError: class extends Error {} }))
vi.mock('@/lib/workspace', () => ({ getSkill: vi.fn() }))
vi.mock('@/lib/billing/credits', () => ({ requireCredits: async () => ({ ok: true }),
  deductByTokens: h.debit, deductCredits: h.fixed }))
import { POST } from '@/app/api/tips/route'

beforeEach(() => vi.resetAllMocks())

function request() {
  return new NextRequest('http://localhost/api/tips', { method: 'POST',
    body: JSON.stringify({ image: 'data:image/png;base64,YQ==', category: 'enhance' }) })
}

describe('Tips billing lifecycle', () => {
  it.each([true, false])('delivers tips and DONE immediately but waits for token billing=%s before closing', async tokens => {
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
    let closed = false
    const end = reader.read().then(result => { closed = result.done; return result })
    await Promise.resolve(); await Promise.resolve()
    expect(closed).toBe(false)
    expect(tokens ? h.debit : h.fixed).toHaveBeenCalledTimes(1)
    expect(tokens ? h.fixed : h.debit).not.toHaveBeenCalled()
    finish()
    expect((await end).done).toBe(true)
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
      expect(h.debit).toHaveBeenCalledTimes(1)
      expect(h.fixed).not.toHaveBeenCalled()
      expect(h.generate).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledTimes(1)
    } finally { log.mockRestore() }
  })
})
