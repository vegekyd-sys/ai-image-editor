import { describe, expect, it } from 'vitest'
import { normalizeGoogleOmniMimeType } from '@/lib/google-omni-video'

describe('google omni video provider', () => {
  it('maps QuickTime MOV uploads to Google Omni supported MIME type', () => {
    expect(normalizeGoogleOmniMimeType('video/quicktime')).toBe('video/mov')
    expect(normalizeGoogleOmniMimeType(' video/quicktime ')).toBe('video/mov')
    expect(normalizeGoogleOmniMimeType('video/mp4')).toBe('video/mp4')
  })
})
