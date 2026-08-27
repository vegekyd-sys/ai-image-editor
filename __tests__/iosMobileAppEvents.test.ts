import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue({
    initialized: true,
    appId: '1690601878920639',
    anonymousId: 'meta-anonymous-id',
    appVersion: '1.0.6',
    appBuild: '16',
    advertiserTrackingStatus: 'notDetermined',
    advertiserIDCollectionEnabled: false,
  }),
  fetchDeferredAppLink: vi.fn().mockResolvedValue({ status: 'empty', url: null }),
  trackEvent: vi.fn().mockResolvedValue({ tracked: true }),
  flush: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@makaron/capacitor-meta-app-events', () => ({ MetaAppEvents: meta }))
vi.mock('@/lib/native-app', () => ({ isMakaronIOSApp: () => true }))

import {
  getMobileAppEventsContext,
  fetchDeferredMobileAppLink,
  fetchDeferredMobileAppLinkResult,
  initializeMobileAppEvents,
  trackMobileAppEvent,
} from '@/lib/marketing/mobile-app-events'

describe('Meta mobile app events bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    meta.initialize.mockResolvedValue({
      initialized: true,
      appId: '1690601878920639',
      anonymousId: 'meta-anonymous-id',
      appVersion: '1.0.6',
      appBuild: '16',
      advertiserTrackingStatus: 'notDetermined',
      advertiserIDCollectionEnabled: false,
    })
    meta.fetchDeferredAppLink.mockResolvedValue({ status: 'empty', url: null })
  })

  it('initializes the official SDK and forwards registration events', async () => {
    expect(await initializeMobileAppEvents()).toBe(true)
    expect(getMobileAppEventsContext()).toEqual({
      provider: 'meta_app_events',
      appId: '1690601878920639',
      anonymousId: 'meta-anonymous-id',
      appVersion: '1.0.6',
      appBuild: '16',
      advertiserTrackingStatus: 'notDetermined',
      advertiserIDCollectionEnabled: false,
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

  it('distinguishes resolved, empty, error, and already-checked deferred lookups', async () => {
    meta.fetchDeferredAppLink.mockResolvedValueOnce({
      status: 'resolved',
      url: 'makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac?utm_source=meta&utm_campaign=asian-culture',
      nativeFetchStartedAt: '2026-08-20T01:02:03Z',
      nativeFetchLatencyMs: 428,
    })
    await expect(fetchDeferredMobileAppLinkResult()).resolves.toMatchObject({
      status: 'resolved',
      url: expect.stringContaining('utm_campaign=asian-culture'),
      nativeFetchStartedAt: '2026-08-20T01:02:03Z',
      nativeFetchLatencyMs: 428,
      context: {
        appVersion: '1.0.6',
        appBuild: '16',
        advertiserTrackingStatus: 'notDetermined',
        advertiserIDCollectionEnabled: false,
      },
    })
    await expect(fetchDeferredMobileAppLinkResult()).resolves.toMatchObject({
      status: 'already_checked',
    })

    localStorage.clear()
    meta.fetchDeferredAppLink.mockResolvedValueOnce({ status: 'empty', url: null })
    await expect(fetchDeferredMobileAppLinkResult()).resolves.toMatchObject({ status: 'empty' })

    localStorage.clear()
    meta.fetchDeferredAppLink.mockResolvedValueOnce({
      status: 'error',
      url: null,
      errorDomain: 'NSURLErrorDomain',
      errorCode: -1009,
      errorDescription: 'The Internet connection appears to be offline.',
      advertiserTrackingStatus: 'denied',
      advertiserIDCollectionEnabled: false,
    })
    await expect(fetchDeferredMobileAppLinkResult()).resolves.toMatchObject({
      status: 'error',
      error: 'The Internet connection appears to be offline.',
      errorDomain: 'NSURLErrorDomain',
      errorCode: -1009,
      context: {
        advertiserTrackingStatus: 'denied',
        advertiserIDCollectionEnabled: false,
      },
    })
    await expect(fetchDeferredMobileAppLinkResult()).resolves.toMatchObject({
      status: 'already_checked',
    })
  })

  it('returns the deferred Meta app link only once per install', async () => {
    localStorage.clear()
    meta.fetchDeferredAppLink.mockResolvedValueOnce({
      status: 'resolved',
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
