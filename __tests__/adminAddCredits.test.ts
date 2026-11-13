import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(), isAdmin: vi.fn(), from: vi.fn(), select: vi.fn(),
  eq: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(), grant: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/billing/credits', () => ({ grantCreditsAndRecordPurchase: mocks.grant }))
import { POST } from '@/app/api/admin/add-credits/route'

const recipientKey = `mk_live_${'a'.repeat(64)}`
const recipientId = '77dffdcf-2e47-4f59-944a-84392885e4c9'
const request = (body: unknown) => new NextRequest('http://localhost/api/admin/add-credits', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'admin-fixture' } })
  mocks.isAdmin.mockResolvedValue(true)
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle }
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  mocks.maybeSingle.mockResolvedValue({ data: { user_id: recipientId }, error: null })
  mocks.rpc.mockResolvedValue({ data: recipientId, error: null })
  mocks.grant.mockResolvedValue({ granted: true, balance: 1321 })
})

describe('admin credit grants', () => {
  it.each(['anonymous', 'ordinary user'])('rejects %s before looking up a recipient', async kind => {
    if (kind === 'anonymous') mocks.authenticateRequest.mockResolvedValue({ error: 'Unauthorized' })
    else mocks.isAdmin.mockResolvedValue(false)
    expect((await POST(request({ apiKey: recipientKey, credits: 100 }))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it.each(['apiKey', 'email'])('resolves a full active key in %s to its owner without recording the credential', async field => {
    const response = await POST(request({ [field]: ` ${recipientKey} `, credits: 100 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, userId: recipientId, credits: 100, newBalance: 1321 })
    expect(mocks.isAdmin).toHaveBeenCalledWith('admin-fixture')
    expect(mocks.authenticateRequest).toHaveBeenCalledOnce()
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('api_keys')
    expect(mocks.select).toHaveBeenCalledWith('user_id')
    expect(mocks.eq.mock.calls).toEqual([
      ['key_hash', createHash('sha256').update(recipientKey).digest('hex')], ['is_active', true],
    ])
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith({
      userId: recipientId, credits: 100, amountUsd: 0, source: 'admin', stripeSessionId: expect.stringMatching(/^admin_/),
    })
  })

  it('rejects an unknown or inactive key without falling back to an email lookup or granting credits', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    const response = await POST(request({ apiKey: recipientKey, credits: 100 }))
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(recipientKey)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('fails closed and hides database details when key lookup fails', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: recipientKey } })
    const response = await POST(request({ apiKey: recipientKey, credits: 100 }))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(recipientKey)
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it.each(['user@example.com', recipientId])('preserves the existing recipient form %s', async email => {
    const response = await POST(request({ email: ` ${email} `, credits: 25 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ userId: recipientId, email, credits: 25 })
    expect(mocks.from).not.toHaveBeenCalled()
    if (email.includes('@')) expect(mocks.rpc).toHaveBeenCalledWith('get_user_id_by_email', { p_email: email })
    else expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.grant).toHaveBeenCalledWith(expect.objectContaining({ userId: recipientId, credits: 25 }))
  })

  it.each([0, -1, 1.5, '100', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid credits %s before lookup', async credits => {
    expect((await POST(request({ apiKey: recipientKey, credits }))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it.each([
    null, {}, { email: 42 }, { email: ' ' }, { apiKey: null }, { apiKey: 'user@example.com' },
    { email: 'user@example.com', apiKey: recipientKey },
  ])('rejects missing, invalid or ambiguous targets %j', async target => {
    expect((await POST(request(target === null ? null : { ...target, credits: 100 }))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const req = new NextRequest('http://localhost/api/admin/add-credits', { method: 'POST', body: '{' })
    expect((await POST(req)).status).toBe(400)
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('distinguishes an email lookup error from a missing user without granting', async () => {
    for (const [error, status] of [[null, 404], [{ message: 'database unavailable' }, 503]] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error })
      expect((await POST(request({ email: 'missing@example.com', credits: 100 }))).status).toBe(status)
    }
    expect(mocks.grant).not.toHaveBeenCalled()
  })
})
