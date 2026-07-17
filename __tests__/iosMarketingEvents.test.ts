import { beforeEach, describe, expect, it, vi } from 'vitest'

const mobileAttribution = vi.hoisted(() => ({
  trackEvent: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: () => true,
}))

vi.mock('@/lib/marketing/attribution', () => ({
  getMarketingAttribution: () => ({
    utm_source: 'meta',
    utm_campaign: 'ios-install-test',
    skill_id: 'skill-123',
  }),
}))

vi.mock('@/lib/marketing/mobile-app-events', () => ({
  getMobileAppEventsContext: () => ({ provider: 'meta_app_events', anonymousId: 'fb-anon-1' }),
  trackMobileAppEvent: mobileAttribution.trackEvent,
}))

import { trackMetaEvent } from '@/lib/marketing/meta-pixel'

describe('iOS marketing events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: undefined,
    })
    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    window.fbq = vi.fn()
  })

  it('records first-party iOS events and forwards them to Meta App Events without firing Pixel', async () => {
    trackMetaEvent('FileSelected', { skill_id: 'skill-123', media_type: 'image' }, 'file.1')
    await Promise.resolve()

    expect(mobileAttribution.trackEvent).toHaveBeenCalledWith(
      'FileSelected',
      expect.objectContaining({
        skill_id: 'skill-123',
        utm_source: 'meta',
      }),
      'file.1',
    )
    expect(window.fbq).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledOnce()

    const request = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(String((request[1] as RequestInit).body))
    expect(body).toMatchObject({
      eventName: 'FileSelected',
      eventId: 'file.1',
      eventSource: 'ios_app',
      skillId: 'skill-123',
      attribution: {
        utm_source: 'meta',
        mobile_sdk: {
          provider: 'meta_app_events',
          anonymousId: 'fb-anon-1',
        },
      },
    })
  })
})
