# Makaron iOS attribution with the Meta SDK

## What ships in phase 1

- Official Meta iOS SDK `18.0.3` through Swift Package Manager.
- Automatic app install, app activation, session, SKAdNetwork, and StoreKit in-app purchase events.
- Native app events for skill view, upload intent, file selection, project creation, registration, and checkout.
- The same product events are also written to `marketing_events` with `event_source = ios_app`.
- Direct links into a skill through `makaron://skill/{skillId}` when the app is installed.
- No ATT prompt and no IDFA collection in phase 1.

Meta receives conversion signals directly from its SDK and uses them for Ads Manager attribution and optimization. The SDK does not expose Meta campaign attribution details to the app. Deferred deep links after a fresh App Store install, and HTTPS Universal Links, require separate follow-up configuration.

## Required Meta configuration

1. In Meta for Developers, open app `1690601878920639`.
2. Add the iOS platform with bundle ID `app.makaron.ios` and App Store ID `6779672002`.
3. Copy the app's Client Token from **App settings > Advanced > Security > Client token**.
4. Add a user-defined Xcode build setting named `FACEBOOK_CLIENT_TOKEN` to the Makaron target for Debug and Release. The value is embedded into `FacebookClientToken` in `Info.plist` at build time.
5. In Events Manager, connect the Meta app data source to the Makaron ad account and confirm app event measurement is enabled.
6. Configure Aggregated Event Measurement priorities after events arrive. Start with `CompleteRegistration`; keep `InitiateCheckout`, `Subscribe`, and `Purchase` below it.

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

1. Add the Client Token and make a fresh development build on a physical iPhone.
2. In Meta Events Manager, open **Test events** for the iOS app data source.
3. Delete Makaron from the phone, reinstall it, launch it, and confirm an app activation appears.
4. Open a skill, select a photo, create the project, and register.
5. Confirm `ViewContent`, `FileSelected`, `CustomizeProduct`, and `CompleteRegistration` appear in Test Events.
6. Confirm the same journey appears in `marketing_events` with `event_source = ios_app`.
7. Repeat once through TestFlight before enabling a registration-optimized campaign.

Do not judge this integration from Ads Manager alone during testing. Test Events confirms transport immediately; attributed installs and conversions can take longer to populate in Ads Manager.

## Privacy gate

`FacebookAdvertiserIDCollectionEnabled` is false and the app does not request ATT in this phase. Before App Store submission, review the SDK privacy manifest and update App Store Connect privacy answers for identifiers, product interaction, advertising/marketing, and analytics as applicable.

Official SDK source and releases: <https://github.com/facebook/facebook-ios-sdk>
