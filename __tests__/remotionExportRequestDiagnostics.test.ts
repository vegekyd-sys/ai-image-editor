// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/remotion/export/route'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  download: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticate }))
vi.mock('@/lib/remotion-export', () => ({
  DEFAULT_REMOTION_RENDER_PROFILE: 'source',
  createRemotionExportJob: mocks.create,
  resolveRemotionExportDownloadUrl: mocks.download,
  shouldRunRemotionExportInline: () => false,
}))

function request() {
  return new NextRequest('http://localhost/api/remotion/export', {
    method: 'POST',
    body: JSON.stringify({ projectId: 'project', designPath: 'private/design.json' }),
  })
}

describe('Remotion export POST diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.authenticate.mockResolvedValue({ auth: { userId: 'user' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('identifies submission failures without logging private errors or request fields', async () => {
    mocks.create.mockRejectedValue(new Error('Design file not found: private/design.json'))
    expect((await POST(request())).status).toBe(500)
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ['[remotion/export] request failed', { stage: 'create_or_reuse_job', jobId: undefined }],
    ])
  })

  it('links a download resolution failure to the job that was created or reused', async () => {
    mocks.create.mockResolvedValue({ id: 'job' })
    mocks.download.mockRejectedValue(new Error('private download URL'))
    expect((await POST(request())).status).toBe(500)
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ['[remotion/export] request failed', { stage: 'resolve_download', jobId: 'job' }],
    ])
  })

  it('keeps access denials out of the service error log', async () => {
    mocks.create.mockRejectedValue(new Error('Forbidden'))
    expect((await POST(request())).status).toBe(403)
    expect(console.error).not.toHaveBeenCalled()
  })
})
