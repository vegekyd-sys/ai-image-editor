import { describe, expect, it } from 'vitest'
import {
  GOOGLE_OMNI_REQUEST_TIMEOUT_MS,
  isGoogleOmniPlaceholderExpired,
} from '@/lib/google-omni-video'

describe('Google Omni video lifecycle', () => {
  it('keeps a fresh synchronous placeholder processing', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z')
    const createdAt = new Date(now - GOOGLE_OMNI_REQUEST_TIMEOUT_MS + 1).toISOString()

    expect(isGoogleOmniPlaceholderExpired(createdAt, now)).toBe(false)
  })

  it('expires a placeholder once the provider request deadline passes', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z')
    const createdAt = new Date(now - GOOGLE_OMNI_REQUEST_TIMEOUT_MS).toISOString()

    expect(isGoogleOmniPlaceholderExpired(createdAt, now)).toBe(true)
  })

  it('does not expire a placeholder with an invalid timestamp before cron recovery', () => {
    expect(isGoogleOmniPlaceholderExpired('invalid', Date.now())).toBe(false)
  })
})
