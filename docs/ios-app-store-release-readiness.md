# Makaron iOS App Store Release Readiness

Last updated: 2026-06-27

This checklist includes the final App Store product-page state prepared for the first iOS submission.

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
- Product page locale: `en-US`
- App category: still requires App Store Connect web UI confirmation if not visible in the submit flow. Recommended primary category `Graphics & Design`, secondary category `Photo & Video`.

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
- Uploaded final iPhone 6.9-inch product screenshots from:
  - `app-store-assets/ios-2026-06-27/final/app-store-01.png`
  - `app-store-assets/ios-2026-06-27/final/app-store-02.png`
  - `app-store-assets/ios-2026-06-27/final/app-store-03.png`
  - `app-store-assets/ios-2026-06-27/final/app-store-04.png`
  - `app-store-assets/ios-2026-06-27/final/app-store-05.png`
- Product screenshots uploaded to App Store Connect screenshot display type `APP_IPHONE_67`, all `COMPLETE`.
- Updated App Store product metadata:
  - Subtitle: `AI creative studio`
  - Description: English product description for AI photo/video creative studio
  - Keywords: `AI photo editor,image editor,video generator,creative studio,photo retouch,design,art`
  - Promotional text: `AI creative editing for photos, videos, and visual ideas.`
  - Marketing URL: `https://www.makaron.app`
  - Copyright: `2026 Shanghai YiTian Network Technology Co., Ltd.`
- Wrote App Review information in App Store Connect:
  - Contact: Tianyi Cai, `+86 13818865130`, `tianyi@versa-ai.com`
  - Demo account required: yes
  - Demo account email: `test-claude@makaron.app`
  - Review notes: AI creative studio test flow + Apple IAP purchase note

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

Confirmed by App Store Connect API on 2026-06-27:

- Top-up review screenshots exist and are `COMPLETE`.
- Subscription review screenshots exist and are `COMPLETE`.
- Top-up localizations exist and are user-facing credit amounts.
- Subscription localizations exist.
- Top-up price schedules exist.
- Subscription prices exist.
- Top-up and subscription availability have `availableInNewTerritories=true`.
- Subscription group levels are ordered Business = 1, Pro = 2, Basic = 3.

Pre-submit checks still required in the web UI:

- Confirm first IAP/subscription package is included with the App Review submission.
- If App Store Connect shows an IAP/subscription warning, resolve it before pressing Submit.

## App Review Information

Do not commit reviewer passwords to the repo.

Known review test account:

- Email: `test-claude@makaron.app`
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
- Age Rating questionnaire is completed in the web UI. API currently shows the age rating declaration exists but its questionnaire fields are still null.

## App Privacy Questionnaire Recommendation

Apple's questionnaire is app-level, not only native SDK-level. It should include data collected by the web app, backend, and third-party service providers used by the iOS app.

Recommended first submission stance after disabling Meta marketing tracking inside the iOS native shell:

- Do not choose "No, we do not collect data from this app".
- Do not declare "Data Used to Track You" for the iOS app as long as Meta Pixel/CAPI and ads attribution remain disabled in the native shell.
- For selected data types, choose "Data Linked to You" when App Store Connect asks whether it is linked to identity. Most Makaron data is keyed by Supabase user id or account email.
- Purposes should generally be limited to App Functionality, Analytics, Product Personalization, and Developer's Advertising or Marketing only if that purpose is still active inside iOS. For the current native shell, avoid advertising/third-party tracking purposes.

Suggested data types:

| Apple category | Data type to select | Why Makaron collects it | Linked to user | Used to track |
| --- | --- | --- | --- | --- |
| Contact Info | Email Address | Account login, support, review/test account, receipts/account recovery | Yes | No |
| User Content | Photos or Videos | User-uploaded input media and generated creative outputs | Yes | No |
| User Content | Other User Content | Prompts, chat messages, project titles/descriptions, generated text, workspace files | Yes | No |
| User Content | Customer Support | Support emails and support context when users contact us | Yes | No |
| Purchases | Purchase History | Apple IAP top-ups/subscriptions, Stripe web billing records, credits ledger | Yes | No |
| Identifiers | User ID | Supabase user id, app account token, API key ownership, Apple transaction ownership | Yes | No |
| Usage Data | Product Interaction | Project creation, feature usage, credit usage, tool/model usage, paywall/checkout attempts | Yes | No |
| Diagnostics | Crash Data | Server/client error reports and app failure diagnostics if captured by platform logs/providers | Yes | No |
| Diagnostics | Performance Data | Latency, provider health, generation status, build/runtime health checks | Yes | No |
| Location | Precise Location | EXIF GPS from uploaded photos, reverse-geocoded for photo context when present | Yes | No |

Usually do not select unless product behavior changes:

- Device ID: leave off unless an IDFA/IDFV/vendor/device identifier is intentionally collected in iOS.
- Advertising Data: leave off for iOS native shell while Meta marketing tracking is disabled.
- Contacts, Health, Financial Info, Browsing History, Search History, Sensitive Info: not part of current Makaron app behavior.

Current location note:

- The current app extracts EXIF photo GPS when present (`extractPhotoMetadata`, `/api/photo-metadata`) and may persist raw lat/lng plus a readable location in snapshot metadata. Therefore select Precise Location unless we deliberately remove or strip this behavior before submission.

Implementation note:

- `MarketingTracker`, `meta-pixel`, and `meta-capi` must remain suppressed for `MakaronIOS` native shell. If Meta Pixel/CAPI is re-enabled inside iOS, revisit App Privacy and likely ATT/tracking implications before submitting an update.

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

- Confirm App Store product page visually in the web UI after API upload.
- Confirm App Privacy questionnaire.
- Complete/confirm Age Rating questionnaire.
- Confirm App Store categories in the web UI. Recommended: primary `Graphics & Design`, secondary `Photo & Video`.
- Confirm first IAP/subscription package is included in the same App Review submission.
- Run final device regression on the exact candidate build.
- Submit app version `1.0` and first IAP/subscription package together from the App Store Connect web UI.

Submission API note:

- `POST /v1/appStoreVersionSubmissions` returned `403` with allowed operation `DELETE`; this API key/API surface cannot create the final submission. Use App Store Connect web UI for the final Submit button.

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
