# Free Credits and Client Save

Status: local candidate on `codex/free-credits-watermark`. Production flag is off.

## Product Contract

- Registration grants the configured welcome credits once, shared by web and iOS.
- Generated previews, persisted originals, Agent outputs, and CLI/MCP results stay clean.
- On web, paid users click Save to download the clean original directly, without
  a preview dialog. Free users see a compact download preview. Save is the primary action;
  Remove watermark is secondary and opens the existing billing flow, with
  Subscription selected first and Top Up second.
- The selected B signature is a white Spark and Makaron wordmark without a plate.
  Images and videos place it at the bottom-right of the actual media frame with a
  2.5% short-edge margin. The signature is cropped to its visible ink before
  positioning so transparent right-side padding cannot push the wordmark left.
  Playback controls sit below the video.
- Uploaded references are not watermarked. Animated and static designs use their
  existing browser export/capture before the free download receives the signature.
- A completed positive-value Stripe or Production Apple purchase unlocks clean web
  downloads. Welcome credits, free introductory trials, Sandbox and refunded rows do not.
- Current access is account-level purchase access. Generated media in native iOS
  uses the same access checks. Free images use Canvas; free videos use device-local
  AVFoundation/Core Image with the exact preview signature, then save to Photos.
  Paid originals and uploaded references retain their direct save path.

## Implementation

`SaveMediaDialog` owns the save choice, preview, progress, cancellation, and return
from checkout. It rechecks purchase access when checkout closes or the browser
regains focus, using bounded polling for a delayed payment webhook. Only a verified
purchase hides the signature; a successful return URL alone does not unlock it.
The selected project/snapshot identity is retained in session storage for up to
30 minutes, so a full-page checkout return restores the same Save window even
if another snapshot arrives meanwhile. The white mark fades/blurs out over 700ms,
with reduced-motion support; the media itself never fades or changes URL.
Subsequent Save clicks check current purchase access and bypass this dialog for
paid users, reusing the prepared-original cache. A paid download also rechecks
access immediately before saving; failed checks never allow a clean download.

`prepareDownloadAsset` reads the existing original or uses the existing Remotion
browser export. No new server-side rendering or private-original bucket is needed.
The old server watermark hooks and proposed bucket migration have been removed.

Image and provider-video previews render directly from the existing original URL;
they do not wait for the full download, purchase check, or watermark encoding.
Private Google file previews keep their authenticated streaming proxy. Video
previews use the current player's decoded dimensions from the Save click,
falling back to snapshot metadata only when playback dimensions are unavailable.
The caption reserves its space during access checks, so video metadata and purchase
verification do not change the initial free Save layout.
The prepared Blob downloads in parallel and is retained in an Editor-scoped LRU cache (three
originals, at most 64 MiB). Source/design changes invalidate the entry; failures
can retry. Closing Save preserves the cache, while leaving the Editor or reloading
clears it. Larger files are not retained. Completed watermarked outputs use weak
Blob-keyed caches, so repeated free saves neither download nor encode again while
the original is retained. Paid access is never inferred from these media caches.

`web-watermark.ts` uses Canvas for PNG and a dynamically loaded, pinned Mediabunny
conversion for MP4. Video frames receive the same Canvas signature; source size
and timing are retained. The conversion begins at the earliest source timestamp
so negative AAC priming packets can be copied instead of causing an audio transcode.
The browser performs video decoding/encoding; the existing video proxy only retrieves
bytes when provider CORS requires it. An unsupported encoder displays a retry error.
Free video saves preload the codec module during preparation, pause the preview,
prefer a hardware encoder only when supported, use an opaque processing canvas,
and throttle progress updates. They do not reduce dimensions, frame count, quality
target or audio fidelity. Paid saves neither preload nor run the watermark encoder.

Local Chromium performance acceptance on 2026-10-01 used a real 10-second 768p
provider video and a 2048px image. With a four-second artificial full-download
delay, the video preview was playable in 385ms; repeated Save reopened in 161ms
and downloaded its byte-identical cached watermark in 30ms. Before the paid-dialog
bypass change, paid preview took
121ms and saved the byte-identical original without another full download or
encoder configuration. The image repeat preview/download took 76ms/31ms.
The isolated encoding comparison improved from 2202ms to 1034ms; the repeat was
a cache hit. These are local warmed-development measurements, not device-wide
performance guarantees. All 243 video frames and the original audio packet hash
were preserved; mean decoded RGB error outside the mark remained below 5/255.

The subsequent paid-direct acceptance covers both image and video: after a free
save and verified local purchase, clicking Save downloads the byte-identical
original with no dialog, no new full-video download and no watermark encoding.
Cached paid video/image saves measured 71ms/50ms in local Chromium.

`GET /api/media/unlock` checks authenticated purchase access only. It neither accepts
nor processes media. No service-role key or payment credential enters the browser.

This client-side model is a conversion prompt, not DRM: clean media is available to
the browser for preview and through the CLI by product design. Videos still require
re-encoding for a burned-in download, while paid originals retain their original bytes.

### Native iOS

WKWebView's video encoder stalled at 2% in actual Simulator acceptance. Native
free video Save therefore uses a distinct `saveWatermarkedVideoToPhotos` action.
AVFoundation composites the shared transparent PNG onto display-oriented frames
on the device, preserving the source audio track. Progress and cancellation are
scoped to the export request; closing Save or timing out cancels the export.
An older binary rejects this action and shows a localized Save error, never a
clean fallback. Ship the new native binary before enabling the feature for iOS.
No watermark composition or video encoding runs on a server.

The Photos bridge retains PNG/JPEG bytes without JPEG recompression, preserving
PNG transparency. Other decodable image formats use lossless PNG conversion for
Photos. This does not change the existing upload/picker normalization.

The installed iOS 27 beta blocked Capacitor's document-start synchronous prompts
for its Cookies and HTTP configuration flags. The native shell supplies those two
read-only values before the Capacitor script, only on iOS 27+, and restores the
ordinary prompt function after both reads. Other prompts retain their delegate.
Actual registration and purchase UI now render; four focused script tests cover
the flag values, delegation and restoration. Earlier iOS versions use the existing
WebView initialization without this script.

Dashboard keeps Apple Restore available when a subscription is already active,
using the existing localized restore label and the same verification/finish flow.

Native navigation must retain `?welcome=1` until the asynchronous welcome response
is displayed and dismissed; removing it sooner remounts the page and loses the
popup. The native signup acceptance covers the real email/OTP UI and 500-point
grant, without requiring a pre-registration Apple trial.
The project overlay's left-edge swipe interception must exclude buttons and links:
the Back button's center falls inside the 36px edge zone, where canceling
`touchstart` also suppresses its click. Actual consecutive image/video Save and
Back navigation passed after this exclusion.

## Acceptance

Reuse the isolated Supabase/Mailpit fixture at API port 55321. No resets or production
database access. The harness rejects an unknown server/build on port 3002.

```sh
npx tsx e2e/free-media.ts --serve
npx tsx e2e/free-media.ts
MAKARON_LIVE_PROVIDER_ENV=/path/to/provider.env npx tsx e2e/free-media.ts --live --serve
MAKARON_LIVE_PROVIDER_ENV=/path/to/provider.env npx tsx e2e/free-media.ts --live --reuse-server
npx tsx e2e/free-media.ts --save-only --reuse-server
npx tsx e2e/free-media.ts --save-only --payments-only --reuse-server
MAKARON_E2E_VIDEO_SOURCE=/path/to/provider-original.mp4 npx tsx e2e/free-media.ts --save-only --reuse-server
```

The harness exercises actual email/OTP signup and welcome grants, clean provider
delivery, Save preview, the existing upgrade UI, browser PNG/MP4 downloads,
square/portrait/landscape/ultrawide/tall image geometry, transparent PNG and a
2048px image, six video aspect ratios, full MP4 decoding, audio packet hashes,
decoded color outside the watermark, 320x568/390x844/1280x900 layouts, and
byte-identical paid originals. Payment fixtures also exercise full-page top-up and
subscription returns, delayed entitlement, the visible fade, and snapshot restoration.
The portrait/landscape codec fixtures explicitly tag limited-range BT.709 to avoid
ambiguous JPEG-to-video range metadata. Purchase rows are deterministic local fixtures.
An optional retained provider video exercises the exact original bytes. Live mode also
requires the first real Agent image run to complete with provider tokens and billing.
Artifacts and screenshots are outside the repository in the printed `/tmp` directory.

Verified on 2026-09-30: real first Agent/Gemini delivery with billed usage; the full
save harness with portrait, landscape and the retained FAL H3 clip; copied audio
packet hashes, decoded RGB checks, responsive layouts, paid byte-identical originals,
and refunded access. The five focused test suites pass 40 tests, with TypeScript,
focused ESLint and the UI i18n guard passing. Optional tips cancelled by navigation
and the local subscription-discovery 403 remain separate application diagnostics.

The existing user's local image/video fixtures were restored from retained originals
to clean preview URLs. Old watermarked assets and a JSON backup were preserved.

### Native Regression Evidence

On 2026-10-01, native iOS 26.5 UI acceptance passed email/password/OTP registration,
the 500-point welcome screen and ledger, and free video Save into the actual Photos
library. The saved MP4 decodes at 768x768 with all 243 frames and 10.144s duration;
the original AAC packet hash is unchanged. The bottom-right white wordmark was
visually inspected on a decoded frame. PNG/JPEG byte retention and signature
geometry also passed hosted Swift tests.

Real `Product.purchase` and StoreKit verification ran in an app-hosted iOS 27 test,
not the older unsigned `--makaron-e2e-local-purchase` fixture. Its JWS traveled
through the authenticated local Apple verification endpoint. The ledger records
Xcode transactions `0`/`1`, a 500-point $4.99 top-up and 3000-point $19.99 Pro
subscription: 500 welcome -> 1000 -> 4000. Replayed receipts and `AppStore.sync` /
`Transaction.currentEntitlements` restoration keep 4000 and two Apple purchase
rows. Xcode/Sandbox still do not unlock production clean-download access.
The local StoreKit catalog needed subscription-group `description` and
`displayName` fields for current Apple test services to decode it.

The subsequent iOS 27 UI regression passed the complete flow in one test run:
email/password/OTP registration, 500 welcome credits, native $4.99 top-up, native
$19.99 Pro subscription, Restore, and both original media saves to Photos.
The final account retains exactly two completed positive-value Xcode purchases,
transaction IDs `12`/`13`, and a 4000-point balance after Restore. These purchases
are initiated by the app's UI and real `Product.purchase`, not unsigned fixture
receipts or a seeded Stripe paid entitlement. Local StoreKit preparation advances
past IDs retained by earlier hosted/UI runs, deletes the uncredited preparation
transactions, and preserves the existing database ledger.

This isolated test explicitly sets `MAKARON_E2E_APPLE_MEDIA_ACCESS=1` so those
genuine local Apple purchases unlock the same original-save path. The switch
requires `MAKARON_E2E=1` and loopback Supabase; shared environments fail closed.
Default production entitlement policy remains Production Apple/positive Stripe
only, excluding Sandbox, local testing, welcome grants, free trials and refunds.

Final Photos resources `IMG_0009.PNG` (1,409,603 bytes) and `IMG_0010.MP4`
(10,188,033 bytes) are byte-identical to their clean originals. Full MP4 decoding
passes with 243 768x768 frames and the original audio. A separate original-save
rerun also passed after resetting only the owned simulator's Photos-add permission,
covering the first native permission sheet and both media saves.
Final full-flow evidence: `/tmp/makaron-ios27-final-full-acceptance.xcresult`.
First-permission/save evidence: `/tmp/makaron-ios27-genuine-apple-original-photos.xcresult`.

Final hosted StoreKit regression also passed all 6 tests: genuine top-up and
subscription verification, duplicate verification, entitlement restore, refund,
expiry, reset, and native media resource/geometry checks. Evidence:
`/tmp/makaron-ios27-final-storekit-regression-isolated-sku.xcresult`.
Transaction-counter preparation uses a separate consumable SKU and deletes only
those unverified local StoreKit preparation transactions, preserving the server ledger.
TypeScript iOS regression passed 136 tests in 23 suites; type checking and the
UI localization guard also passed.

The older iOS 26.5 runtime still rejects SDK 27 StoreKit test configuration with
`SKInternalErrorDomain(3)`; complete StoreKit UI acceptance uses the matching
iOS 27 runtime. Apple system payment dialogs are disabled for this local regression.
No real Apple charge, Apple Sandbox account, physical-device/TestFlight acceptance,
production access-policy relaxation, or deployment was performed.

Reusable isolated native fixtures live in `e2e/ios-subscription/native-fixtures.mjs`.
Start the existing local runtime first, configure `ios:local` for port 3002 and
provide an owned Simulator ID:

```sh
MAKARON_E2E_SIMULATOR_ID=<owned-simulator-uuid> node e2e/ios-subscription/native-fixtures.mjs
```

The helper refuses a non-loopback database or non-E2E environment; accounts must
already be UI-registered `ios-free-media+...@e2e.makaron.test` fixtures. It never
resets the database or deletes Photos. Original image/video paths and evidence
directory are configurable via `MAKARON_E2E_NATIVE_IMAGE`,
`MAKARON_E2E_NATIVE_VIDEO` and `MAKARON_E2E_NATIVE_ARTIFACTS`.
UI tests opt in with `MAKARON_E2E_NATIVE_LOCAL=1` and `MAKARON_E2E_EMAIL`; the
hosted genuine StoreKit test uses the same registered account across reruns,
because Xcode reuses numeric IDs after clearing local transactions and server
deduplication rows must remain intact.

Native result bundles are `/tmp/makaron-ios26-registration-welcome-final.xcresult`,
`/tmp/makaron-ios26-native-save-final-acceptance.xcresult` and
`/tmp/makaron-ios27-genuine-storekit-ledger-pass.xcresult`. Broader TypeScript iOS
regression passed 132 tests in 22 suites. Actual native generation of a new media
asset remains distinct from Save acceptance using retained real provider media.

The final consecutive native Save UI tests both passed. Free Photos outputs are
`IMG_0014.PNG` and `IMG_0015.MP4`; the video preview was playing at 0:01/0:10,
and its complete 243-frame decode passed. Video PSNR outside the watermark is
45.05dB over all frames, with unchanged source dimensions and AAC packet hash.
Paid-state Photos outputs `IMG_0016.PNG` / `IMG_0017.MP4` exactly match their
original file SHA-256 hashes. That paid-state test uses a deterministic positive
Stripe purchase row in the isolated fixture database, not an Apple production
purchase or an interactive Stripe checkout. It does not grant additional credits.
Screenshots are in `/tmp/makaron-ios26-native-save-final-attachments`; original
media and scoped ledger evidence are in `/tmp/makaron-ios-free-media-evidence`.

## Remaining Release Work

- Complete interactive Stripe subscription/refund acceptance. Test checkout
  creation and the official Stripe test top-up fixture through the CLI webhook,
  credit grant and clean-download entitlement are verified; return-to-Save uses
  deterministic local purchase fixtures.
- Complete Apple system payment-sheet and physical-device Sandbox/TestFlight
  acceptance. The local native registration, top-up, subscription, restore and
  original image/video Photos Save workflow is now verified.
- Safari/Chrome compatibility across long/high-resolution videos and HDR/wide-gamut media.
- Broader application flows and generation models: a focused save test does not validate
  unrelated preview providers, optional tips, or every export surface.
- Production rollout of `NEXT_PUBLIC_FREE_MEDIA_ENABLED` after product acceptance.

No merge, production deployment, shared environment update or production migration
has been performed for this candidate.
