# Makaron iOS App Store Release Readiness

Last updated: 2026-06-27

This checklist intentionally excludes App Store product page copy and screenshots because that work is being prepared separately.

## Current App Store Connect Snapshot

- App: `Makaron`
- Bundle ID: `app.makaron.ios`
- App Store Connect App ID: `6779672002`
- App Store version: `1.0`
- Version state: `PREPARE_FOR_SUBMISSION`
- Selected build: `1.0 (5)`
- Build ID: `df280aa7-7b9f-41c9-ad69-e992b0f9c52d`
- Build state: `VALID`
- Encryption: `usesNonExemptEncryption=false`
- Release type: `AFTER_APPROVAL`
- Public TestFlight link: `https://testflight.apple.com/join/fgPusTG9`

## Prepared This Pass

- Selected the latest valid build `1.0 (5)` for App Store version `1.0`.
- Added public Privacy Policy URL surface: `https://www.makaron.app/privacy`.
- Added public Support URL surface: `https://www.makaron.app/support`.
- Added `/privacy` and `/support` to public middleware routes.
- Added `/privacy` and `/support` to sitemap/robots public surfaces.
- Deployed production web with `/privacy` and `/support`.
- Set App Store Connect Privacy Policy URL to `https://www.makaron.app/privacy`.
- Set App Store Connect Support URL to `https://www.makaron.app/support`.
- Verified native privacy manifest and permission strings:
  - `ios/App/App/PrivacyInfo.xcprivacy`
  - `ios/App/App/Info.plist`
- Verified App Store Connect API key path exists:
  - `/Users/tianyicai/.appstoreconnect/makaron/api-key.json`
  - `/Users/tianyicai/.appstoreconnect/makaron/AuthKey_X9947Z2DZ6.p8`

## In-App Purchases and Subscriptions

Current API state:

Consumable top-ups, all `READY_TO_SUBMIT`:

- `app.makaron.ios.topup.starter` — Starter Top Up
- `app.makaron.ios.topup.pro` — Pro Top Up
- `app.makaron.ios.topup.team` — Team Top Up
- `app.makaron.ios.topup.studio` — Studio Top Up
- `app.makaron.ios.topup.enterprise` — Enterprise Top Up

Subscription group:

- `Makaron Pro`

Subscriptions, all `READY_TO_SUBMIT`:

- `app.makaron.ios.subscription.basic.monthly` — Basic Monthly
- `app.makaron.ios.subscription.basic.annual` — Basic Annual
- `app.makaron.ios.subscription.pro.monthly` — Pro Monthly
- `app.makaron.ios.subscription.pro.annual` — Pro Annual
- `app.makaron.ios.subscription.business.monthly` — Business Monthly
- `app.makaron.ios.subscription.business.annual` — Business Annual

Pre-submit checks still required:

- Confirm all IAP/subscription review screenshots are uploaded.
- Confirm all IAP/subscription localizations are user-facing and consistent with in-app UI.
- Confirm subscription group display order and subscription display order.
- Confirm all intended territories/prices are active.
- Confirm first IAP/submission package is included with App Review submission.

## App Review Information

Do not commit reviewer passwords to the repo.

Known review test account:

- Email: use the existing App Store Connect review test account.
- Password: stored outside repo / entered in App Store Connect only.

Contact:

- Name: Tianyi Cai
- Phone: `+86 13818865130`
- Email: `tianyi@versa-ai.com`

Reviewer notes draft:

```text
Makaron is an AI creative studio for editing images and generating creative media.

To test:
1. Sign in with the provided review account.
2. Open Home and choose a Skill.
3. Upload or take a photo.
4. Generate a preview/edit and open the chat/editor flow.
5. Open Dashboard to test credits, subscriptions, and top-up products.

On iOS, subscriptions and top-ups are purchased through Apple In-App Purchase. Web checkout providers are not used inside the iOS app.

If testing purchases, use Apple Sandbox. Credits should update after the transaction verifies.
```

## Privacy and Compliance

Prepared:

- Privacy Policy page exists at `/privacy`.
- Support page exists at `/support`.
- `ITSAppUsesNonExemptEncryption=false` is set in `Info.plist`.
- Permission strings are specific to user-chosen creative media:
  - Camera
  - Microphone
  - Photo Library read
  - Photo Library add
- Privacy manifest currently declares:
  - No tracking
  - No collected data types in native manifest
  - UserDefaults accessed API reason `CA92.1`

Must verify in App Store Connect:

- App Privacy questionnaire matches actual product behavior, not only native manifest.
- Account identifiers, user content, purchases, product interaction, diagnostics, and support communications are disclosed if Apple asks at the App Privacy level.
- Privacy Policy URL remains set to `https://www.makaron.app/privacy`.
- Support URL remains set to `https://www.makaron.app/support`.

## Final Technical Gate Before Submit

Run from repo root:

```bash
git status --short
npm run release:check -- --local
npm run test:ios
npm run build
```

Then deploy production web:

```bash
npx vercel --prod
curl -sSI https://www.makaron.app/home | sed -n '1,24p'
curl -sS https://www.makaron.app/api/health
curl -sSI https://www.makaron.app/privacy | sed -n '1,20p'
curl -sSI https://www.makaron.app/support | sed -n '1,20p'
```

If the native wrapper changed, run the TestFlight release skill:

```text
Use makaron-ios-testflight-release.
```

## Required Device Regression

Use a real iPhone with the latest TestFlight/App Store candidate:

- Cold launch reaches production Makaron.
- Sign out on Home, then verify Home still scrolls.
- Login from Skill detail returns to the same Skill detail.
- Photo library upload works.
- Camera photo upload works, including HEIC conversion path.
- Chat input on Skill detail is not covered by keyboard.
- Inline image tap opens the small preview.
- Large image tap returns to GUI/canvas with the expected transition.
- Subscription purchase succeeds and updates credits/subscription state.
- Top-up purchase succeeds and updates credits.
- Restore subscription path works or returns a clear no-active-subscription message.
- Purchase cancellation/failure returns a user-readable message, not a Next.js error overlay.

Known launch caveat:

- iOS login edge-swipe may still show login under login in some navigation cases. This is tolerated for launch, not considered fully fixed.

## Remaining P0 Before Submit

- App Store product page copy and screenshots from the other agent.
- Fill or verify App Review contact, reviewer notes, and test account in App Store Connect.
- Confirm App Privacy questionnaire.
- Confirm IAP/subscription screenshots, prices, territories, and localization.
- Run final device regression on the exact candidate build.
- Submit app version `1.0` and first IAP/subscription package together.

## P1 Launch Operations

- Production monitoring watch:
  - Vercel deployment and `/api/health`
  - Supabase auth/storage/database errors
  - Apple purchase verification errors
  - AI provider health and cost spikes
- Create a small launch feedback form or feedback inbox label.
- Prepare a short launch announcement linking to the App Store page once live.
- Submit sitemap in Google Search Console after production deploy.
- Re-check `/privacy`, `/support`, `/sitemap.xml`, and `/robots.txt` after deploy.
