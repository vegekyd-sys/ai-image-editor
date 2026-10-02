// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
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
  })
})
