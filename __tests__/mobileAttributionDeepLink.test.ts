import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@makaron/capacitor-meta-app-events', () => ({
  MetaAppEvents: {
    initialize: vi.fn(),
    trackEvent: vi.fn(),
  },
}))
vi.mock('@/lib/native-app', () => ({ isMakaronIOSApp: () => true }))

import {
  captureMobileDeepLinkAttribution,
  routeForMakaronDeepLink,
} from '@/lib/marketing/mobile-app-events'

describe('Makaron mobile attribution deep links', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'mkr_attribution=; path=/; max-age=0'
  })

  it('routes the custom skill scheme into the native home skill overlay', () => {
    expect(routeForMakaronDeepLink('makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac'))
      .toBe('/home?skill=7ef2c391-a7e4-4519-ac06-62ec3acff2ac')
  })

  it('preserves trusted Meta attribution parameters when routing into the app', () => {
    const deepLink = [
      'makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac',
      '?utm_source=meta',
      '&utm_medium=paid_social',
      '&utm_campaign=ios_attribution_v2_stadium_15usd_20260724',
      '&utm_content=stadium_broadcast_candid_v2',
      '&campaign_id=120250000000000001',
      '&adset_id=120250000000000002',
      '&ignored=drop-me',
    ].join('')

    expect(routeForMakaronDeepLink(deepLink)).toBe(
      '/home?skill=7ef2c391-a7e4-4519-ac06-62ec3acff2ac'
      + '&utm_source=meta'
      + '&utm_medium=paid_social'
      + '&utm_campaign=ios_attribution_v2_stadium_15usd_20260724'
      + '&utm_content=stadium_broadcast_candid_v2'
      + '&campaign_id=120250000000000001'
      + '&adset_id=120250000000000002',
    )
  })

  it('persists deep-link attribution before the first app event is recorded', () => {
    const attribution = captureMobileDeepLinkAttribution(
      'makaron://skill/skill-123'
      + '?utm_source=meta'
      + '&utm_campaign=ios-attribution-test'
      + '&creative_id=creative-456',
    )

    expect(attribution).toMatchObject({
      utm_source: 'meta',
      utm_campaign: 'ios-attribution-test',
      creative_id: 'creative-456',
      skill_id: 'skill-123',
      landing_path: '/home?skill=skill-123'
        + '&utm_source=meta'
        + '&utm_campaign=ios-attribution-test'
        + '&creative_id=creative-456',
    })
    expect(JSON.parse(localStorage.getItem('mkr_marketing_attribution') || '{}')).toMatchObject({
      utm_source: 'meta',
      utm_campaign: 'ios-attribution-test',
      creative_id: 'creative-456',
      skill_id: 'skill-123',
    })
    expect(decodeURIComponent(document.cookie)).toContain('"utm_campaign":"ios-attribution-test"')
  })

  it('routes existing share links and query links to the same skill screen', () => {
    expect(routeForMakaronDeepLink('https://www.makaron.app/home/skill-123'))
      .toBe('/home?skill=skill-123')
    expect(routeForMakaronDeepLink('https://makaron.app/home?skill=skill-456'))
      .toBe('/home?skill=skill-456')
  })

  it('does not route untrusted domains', () => {
    expect(routeForMakaronDeepLink('https://example.com/home/skill-123')).toBeUndefined()
  })
})
