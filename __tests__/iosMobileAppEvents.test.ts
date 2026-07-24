import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue({
    initialized: true,
    appId: '1690601878920639',
    anonymousId: 'meta-anonymous-id',
  }),
  fetchDeferredAppLink: vi.fn().mockResolvedValue({ url: null }),
  trackEvent: vi.fn().mockResolvedValue({ tracked: true }),
  flush: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@makaron/capacitor-meta-app-events', () => ({ MetaAppEvents: meta }))
vi.mock('@/lib/native-app', () => ({ isMakaronIOSApp: () => true }))

import {
  getMobileAppEventsContext,
  fetchDeferredMobileAppLink,
  initializeMobileAppEvents,
  trackMobileAppEvent,
} from '@/lib/marketing/mobile-app-events'

describe('Meta mobile app events bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the official SDK and forwards registration events', async () => {
    expect(await initializeMobileAppEvents()).toBe(true)
    expect(getMobileAppEventsContext()).toEqual({
      provider: 'meta_app_events',
      appId: '1690601878920639',
      anonymousId: 'meta-anonymous-id',
    })

    expect(await trackMobileAppEvent('CompleteRegistration', {}, 'registration.1')).toBe(true)
    expect(meta.trackEvent).toHaveBeenCalledWith({
      eventName: 'CompleteRegistration',
      eventId: 'registration.1',
      params: {},
      value: undefined,
      currency: undefined,
    })
  })

  it('returns the deferred Meta app link only once per install', async () => {
    localStorage.clear()
    meta.fetchDeferredAppLink.mockResolvedValueOnce({
      url: 'makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac',
    })

    await expect(fetchDeferredMobileAppLink()).resolves.toBe(
      'makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac',
    )
    await expect(fetchDeferredMobileAppLink()).resolves.toBeUndefined()
    expect(meta.fetchDeferredAppLink).toHaveBeenCalledTimes(1)
  })

  it('quietly skips deferred links in an older native shell', async () => {
    localStorage.clear()
    const fetchDeferredAppLink = meta.fetchDeferredAppLink
    Object.defineProperty(meta, 'fetchDeferredAppLink', {
      configurable: true,
      value: undefined,
      writable: true,
    })

    try {
      await expect(fetchDeferredMobileAppLink()).resolves.toBeUndefined()
    } finally {
      meta.fetchDeferredAppLink = fetchDeferredAppLink
    }
  })

  it.each(['AppFirstOpen', 'StartTrial', 'Subscribe', 'Purchase'] as const)(
    'leaves %s to Meta automatic logging',
    async (eventName) => {
      expect(await trackMobileAppEvent(eventName, {}, `${eventName}.1`)).toBe(false)
      expect(meta.trackEvent).not.toHaveBeenCalled()
    },
  )
})
