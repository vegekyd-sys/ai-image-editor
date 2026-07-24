# Makaron iOS attribution with the Meta SDK

## What ships in phase 1

- Official Meta iOS SDK `18.0.3` through Swift Package Manager.
- Automatic app install, app activation, session, SKAdNetwork, and StoreKit in-app purchase events.
- Native app events for skill view, upload intent, file selection, project creation, registration, and checkout.
- The same product events are also written to `marketing_events` with `event_source = ios_app`.
- Direct links into a skill through `makaron://skill/{skillId}` when the app is installed.
- Deferred Meta App Links into the same skill after a fresh App Store install.
- No ATT prompt and no IDFA collection in phase 1.

Meta receives conversion signals directly from its SDK and uses them for Ads Manager attribution and optimization. The SDK does not expose Meta campaign attribution details to the app. Meta deferred links are resolved once per install after the native SDK initializes. A direct launch URL or a locally pending URL always wins. HTTPS Universal Links remain a separate follow-up.

## Required Meta configuration

1. In Meta for Developers, open app `1690601878920639`.
2. Add the iOS platform with bundle ID `app.makaron.ios` and App Store ID `6779672002`.
3. Copy the app's Client Token from **App settings > Advanced > Security > Client token**.
4. Confirm the Client Token is embedded as `FacebookClientToken` in `ios/App/App/Info.plist`. The release-readiness test rejects a missing token or build-setting placeholder.
5. In Events Manager, connect the Meta app data source to the Makaron ad account and confirm app event measurement is enabled.
6. Configure Aggregated Event Measurement priorities after events arrive. Start with `CompleteRegistration`; keep `InitiateCheckout`, `Subscribe`, and `Purchase` below it.
7. For a skill-specific app ad, set the deferred deep link to `makaron://skill/{skillId}` and keep the App Store listing as its fallback destination.

The Meta Client Token is a public app identifier intended to ship in the client. It is not the system-user access token used by the Marketing API.

## Event ownership

Meta SDK automatic events:

- Install and app activation/session.
- `StartTrial`, `Subscribe`, and `Purchase` from StoreKit transactions.

Makaron manual Meta events:

- `ViewContent`
- `UploadIntent`
- `FileSelected`
- `CustomizeProduct`
- `CompleteRegistration`
- `InitiateCheckout`

Makaron keeps `AppFirstOpen`, trial, subscription, and purchase in first-party telemetry too, but deliberately does not forward them manually to the native Meta bridge. This prevents duplicate install and revenue events.

The bridge does not send Makaron's Supabase user UUID to Meta. First-party `marketing_events` still links authenticated events to `user_id` on the server.

## Release verification

1. Make a fresh development build on a physical iPhone.
2. In Meta Events Manager, open **Test events** for the iOS app data source.
3. Delete Makaron from the phone, reinstall it, launch it, and confirm an app activation appears.
4. Test a Meta deferred link such as `makaron://skill/{skillId}` and confirm the first launch enters that skill after the AI-content consent screen.
5. Select a photo, create the project, and register.
6. Confirm `ViewContent`, `FileSelected`, `CustomizeProduct`, and `CompleteRegistration` appear in Test Events.
7. Confirm the same journey appears in `marketing_events` with `event_source = ios_app`.
8. Repeat once through TestFlight before enabling a registration-optimized campaign.

Do not judge this integration from Ads Manager alone during testing. Test Events confirms transport immediately; attributed installs and conversions can take longer to populate in Ads Manager.

## Privacy gate

`FacebookAdvertiserIDCollectionEnabled` is false and the app does not request ATT in this phase. Before App Store submission, review the SDK privacy manifest and update App Store Connect privacy answers for identifiers, product interaction, advertising/marketing, and analytics as applicable.

Official SDK source and releases: <https://github.com/facebook/facebook-ios-sdk>
