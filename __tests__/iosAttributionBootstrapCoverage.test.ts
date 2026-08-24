import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(process.cwd())

describe('iOS attribution bootstrap coverage', () => {
  it('captures launch or deferred attribution before recording first open', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/components/MobileAppEventsBootstrap.tsx'),
      'utf8',
    )
    const launchLookup = source.indexOf('const launchUrl = await App.getLaunchUrl()')
    const deferredLookup = source.indexOf('const deferred = await fetchDeferredMobileAppLinkResult(')
    const captureCall = source.indexOf('captureMobileDeepLinkAttribution(value)')
    const firstOpenCall = source.lastIndexOf('recordFirstOpen(launchSource, deferredStatus)')

    expect(launchLookup).toBeGreaterThan(-1)
    expect(deferredLookup).toBeGreaterThan(launchLookup)
    expect(captureCall).toBeGreaterThan(-1)
    expect(firstOpenCall).toBeGreaterThan(deferredLookup)
    expect(source).toContain('error_domain: deferred.errorDomain')
    expect(source).toContain('error_code: deferred.errorCode')
    expect(source).toContain('native_fetch_started_at: deferred.nativeFetchStartedAt')
    expect(source).toContain('native_fetch_latency_ms: deferred.nativeFetchLatencyMs')
  })

  it('does not treat welcome credits as a paid trial', () => {
    const sources = [
      'src/app/api/auth/activate/route.ts',
      'src/app/api/auth/complete/route.ts',
      'src/app/home/page.tsx',
      'src/app/login/page.tsx',
    ].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8'))

    for (const source of sources) {
      expect(source).not.toContain("trackMetaEvent('StartTrial'")
      expect(source).not.toContain("eventName: 'StartTrial'")
    }
  })
})
