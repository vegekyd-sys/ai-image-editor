# iOS Migration Test Targets

## Goal

Makaron iOS is considered migration-ready when the TestFlight build and the shared web code both pass the automated checks below, and the same production web deployment can update web and iOS behavior without rebuilding the native binary.

## Automated Coverage

- Native detection: `MakaronIOS` user agent and Capacitor iOS platform both activate iOS-specific behavior.
- Keyboard adaptation: visual viewport keyboard overlap is clamped, rounded, and ignored when the keyboard is not active.
- Billing compliance: iOS native app mode suppresses Stripe checkout/subscription entry points until StoreKit is implemented.
- App Store readiness: Capacitor config uses a bundled launch shell, avoids production `server.url`, includes iOS navigation allowlist, and keeps zoom disabled.

## Manual Device Acceptance

- Launch from a real iPhone and reach `https://www.makaron.app` from the bundled shell.
- Login with email OTP; Google login is not shown in the iOS WebView path.
- Upload an image or HEIC, generate tips, preview, commit, and open CUI.
- Focus every chat/editor textarea; keyboard must not cover the active input or cause a persistent layout jump.
- Trigger credits exhausted UI; no Stripe Top Up or Subscribe button appears inside the iOS app.
- Save/share image and video outputs through the iOS share sheet or a working fallback.

## App Store Review Defaults

- Digital credits/subscriptions are not sold through Stripe inside iOS. StoreKit must be added before enabling in-app purchase.
- Privacy policy, support URL, demo account, and reviewer notes must be prepared in App Store Connect before external review.
- Permission strings must explain camera/photo/microphone use for user-selected creative assets only.
- The app should be tested on device before submission and must not present placeholder or beta-only content.
