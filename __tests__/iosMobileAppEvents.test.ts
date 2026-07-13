import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue({
    initialized: true,
    appId: '1690601878920639',
    anonymousId: 'meta-anonymous-id',
  }),
  trackEvent: vi.fn().mockResolvedValue({ tracked: true }),
  flush: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@makaron/capacitor-meta-app-events', () => ({ MetaAppEvents: meta }))
vi.mock('@/lib/native-app', () => ({ isMakaronIOSApp: () => true }))

import {
  getMobileAppEventsContext,
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

  it.each(['AppFirstOpen', 'StartTrial', 'Subscribe', 'Purchase'] as const)(
    'leaves %s to Meta automatic logging',
    async (eventName) => {
      expect(await trackMobileAppEvent(eventName, {}, `${eventName}.1`)).toBe(false)
      expect(meta.trackEvent).not.toHaveBeenCalled()
    },
  )
})
