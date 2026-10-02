// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('free media deployment flag', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['', false],
    [undefined, false],
    ['invalid', false],
  ])('evaluates %s as %s without mocking the policy', async (value, enabled) => {
    vi.stubEnv('NEXT_PUBLIC_FREE_MEDIA_ENABLED', value)
    vi.resetModules()
    const policy = await import('@/lib/free-media-policy')
    expect(policy.FREE_MEDIA_ENABLED).toBe(enabled)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone) MakaronIOS' })
    expect(policy.isWatermarkSaveFlowEnabled()).toBe(enabled)
  })
})

describe('iOS App-only watermark save scope', () => {
  it.each([
    ['desktop Chrome', 'Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36', false],
    ['Android H5', 'Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Mobile Safari/537.36', false],
    ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) Version/27.0 Mobile Safari/604.1', false],
    ['iPad Safari', 'Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X) Version/27.0 Mobile Safari/604.1', false],
    ['old iOS App shell', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile/15E148 MakaronIOS', true],
    ['new iOS App shell', 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) Mobile/15E148 MakaronIOS', true],
  ])('limits the watermark flow on %s to %s', async (_platform, userAgent, enabled) => {
    vi.stubEnv('NEXT_PUBLIC_FREE_MEDIA_ENABLED', 'true')
    vi.stubGlobal('navigator', { userAgent })
    const policy = await import('@/lib/free-media-policy')
    expect(policy.FREE_MEDIA_ENABLED).toBe(true)
    expect(policy.isWatermarkSaveFlowEnabled()).toBe(enabled)
  })

  it('does not enable the client watermark flow during server rendering', async () => {
    vi.stubEnv('NEXT_PUBLIC_FREE_MEDIA_ENABLED', 'true')
    vi.stubGlobal('navigator', undefined)
    const policy = await import('@/lib/free-media-policy')
    expect(policy.FREE_MEDIA_ENABLED).toBe(true)
    expect(policy.isWatermarkSaveFlowEnabled()).toBe(false)
  })
})
