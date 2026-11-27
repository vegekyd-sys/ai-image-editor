// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/remotion/export/[id]/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), lookup: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.auth }))
vi.mock('@/lib/remotion-export', () => ({
  getRemotionExportJob: mocks.lookup,
  resolveRemotionExportDownloadUrl: mocks.download,
}))

const jobId = '12345678-9abc-4321-8765-0123456789ab'
function poll(id: string) {
  return GET(new NextRequest('http://localhost/api/remotion/export/' + id), { params: Promise.resolve({ id }) })
}

describe('Remotion export status lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ auth: { userId: 'owner' } })
    mocks.lookup.mockImplementation(async id => {
      if (id !== jobId) throw new Error('invalid input syntax for type uuid')
      return { id, user_id: 'owner', status: 'failed', error: 'media validation failed' }
    })
    mocks.download.mockResolvedValue(null)
  })

  it.each([jobId, 'remotion-export-' + jobId, 'remotion-export-pending-' + jobId])(
    'returns the stored failure for %s', async id => {
      const res = await poll(id)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ jobId, status: 'failed', error: 'media validation failed' })
      expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(jobId)
    },
  )

  it.each(['not-a-job', 'remotion-export-pending-invalid'])('rejects invalid identifier %s before lookup', async id => {
    expect((await poll(id)).status).toBe(404)
    expect(mocks.lookup).not.toHaveBeenCalled()
  })

  it('checks ownership before resolving the download', async () => {
    mocks.auth.mockResolvedValue({ auth: { userId: 'other' } })
    expect((await poll('remotion-export-' + jobId)).status).toBe(403)
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
