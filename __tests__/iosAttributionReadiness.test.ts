import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('iOS attribution release contract', () => {
  it('pins the official Meta SDK and exposes the Capacitor native bridge', () => {
    const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    const swiftPackage = fs.readFileSync(
      path.join(root, 'plugins/capacitor-meta-app-events/Package.swift'),
      'utf8',
    )
    const plugin = fs.readFileSync(
      path.join(root, 'plugins/capacitor-meta-app-events/ios/Sources/MetaAppEventsPlugin/MetaAppEventsPlugin.swift'),
      'utf8',
    )
    const appDelegate = fs.readFileSync(path.join(root, 'ios/App/App/AppDelegate.swift'), 'utf8')

    expect(packageJson).toContain('@makaron/capacitor-meta-app-events')
    expect(packageJson).not.toContain('@makaron/capacitor-adjust-attribution')
    expect(swiftPackage).toContain('https://github.com/facebook/facebook-ios-sdk.git')
    expect(swiftPackage).toContain('exact: "18.0.3"')
    expect(swiftPackage).toContain('exact: "8.3.4"')
    expect(plugin).toContain('Settings.shared.isAdvertiserIDCollectionEnabled = false')
    expect(plugin).toContain('Settings.shared.isAutoLogAppEventsEnabled = true')
    expect(plugin).toContain('Settings.shared.isSKAdNetworkReportEnabled = true')
    expect(plugin).toContain('#if DEBUG')
    expect(plugin).toContain('Settings.shared.loggingBehaviors.insert(.networkRequests)')
    expect(plugin).toContain('ApplicationDelegate.shared.application')
    expect(plugin).toContain('AppLinkUtility.fetchDeferredAppLink')
    expect(plugin).toContain('CAPPluginMethod(name: "fetchDeferredAppLink"')
    expect(plugin).toContain('#if DEBUG')
    expect(plugin).toContain('-MakaronDeferredAppLink')
    expect(plugin.indexOf('ApplicationDelegate.shared.application')).toBeLessThan(
      plugin.indexOf('Settings.shared.isAdvertiserIDCollectionEnabled = false'),
    )
    expect(plugin).toContain('AppEvents.Name.completedRegistration')
    expect(plugin).toContain('AppEvents.Name.customizeProduct')
    expect(plugin).toContain('AppEvents.Name.initiatedCheckout')
    expect(plugin.match(/AppEvents\.shared\.flush\(\)/g)).toHaveLength(3)
    expect(plugin).not.toContain('AppEvents.shared.userID')
    expect(appDelegate).toContain('MetaAppEventsLifecycle.application')
  })

  it('configures privacy-preserving app events and mounts the native bootstrap', () => {
    const info = fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8')
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8')
    const bootstrap = fs.readFileSync(
      path.join(root, 'src/components/MobileAppEventsBootstrap.tsx'),
      'utf8',
    )

    expect(info).toContain('<string>makaron</string>')
    expect(info).toContain('<string>app.makaron.ios</string>')
    expect(info.match(/<key>CFBundleURLTypes<\/key>/g)).toHaveLength(1)
    expect(info).toContain('<key>FacebookAppID</key>')
    expect(info).toContain('<string>1690601878920639</string>')
    expect(info).toContain('<key>FacebookClientToken</key>')
    expect(info).toContain('<string>3aec175e7355013cc4a5a88ed8397499</string>')
    expect(info).not.toContain('$(FACEBOOK_CLIENT_TOKEN)')
    expect(info).toContain('<key>FacebookAdvertiserIDCollectionEnabled</key>')
    expect(info).toContain('<false/>')
    expect(info).toContain('<string>v9wttpbfk9.skadnetwork</string>')
    expect(info).toContain('<string>n38lu8286q.skadnetwork</string>')
    expect(info).not.toContain('NSUserTrackingUsageDescription')
    expect(layout).toContain('<MobileAppEventsBootstrap />')
    expect(bootstrap).toContain('initializeMobileAppEvents')
    expect(bootstrap).toContain("App.addListener('appUrlOpen'")
    expect(bootstrap).toContain('fetchDeferredMobileAppLink')
  })
})
