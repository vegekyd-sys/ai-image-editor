import { describe, expect, it } from 'vitest'
import { routeForMakaronDeepLink } from '@/lib/marketing/mobile-app-events'

describe('Makaron mobile attribution deep links', () => {
  it('routes the custom skill scheme into the native home skill overlay', () => {
    expect(routeForMakaronDeepLink('makaron://skill/7ef2c391-a7e4-4519-ac06-62ec3acff2ac'))
      .toBe('/home?skill=7ef2c391-a7e4-4519-ac06-62ec3acff2ac')
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
