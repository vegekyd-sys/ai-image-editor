# Free Credits and Client Save

Status: versioned candidate on `codex/free-credits-watermark`; dedicated phone
Preview deployed on 2026-10-01. No production rollout has been performed.

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
  uses the same access checks. Free images use Canvas. Free videos on old shells
  receive their signature in the WebView, then use the existing `saveToPhotos`
  bridge; new shells declaring native media protocol v1 and video-watermark
  support use AVFoundation. The old-shell rollout does not require an iOS release.
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

`web-watermark.ts` uses Canvas for PNG and dynamically loaded, pinned Mediabunny
sources/sinks for MP4. Decoded video samples receive the same Canvas signature and
are encoded at display dimensions. Audio packets are copied without re-encoding;
all timestamps shift from the earliest source timestamp, including negative AAC
priming packets. Muxed start times/duration can therefore differ slightly from the
original container; frame count and encoded audio data are retained.
The browser performs video decoding/encoding; the existing video proxy only retrieves
bytes when provider CORS requires it. An unsupported encoder displays a retry error.
Free video saves preload the codec module during preparation, pause the preview,
use the available WebCodecs encoder, an opaque processing canvas,
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

### Native vs Web Save Timing

An alternating A/B on 2026-10-01 compared the retained AVFoundation candidate
with the new web encoder on the same official iOS 27.0 `24A434` Simulator,
device `82B3B260-7CE8-4D0A-8A13-00FA4A2C6B32`, and the same previously built
candidate Debug app. Both paths received identical prepared originals and the
shared signature. Modules were preloaded; each run used a fresh Blob to bypass
the completed-output cache. Three rounds alternated native/web order. Timings
cover prepared-original -> successful Photos response, excluding download,
preview preparation, artificial pre-click waits and permission prompts.

| Source | Native median | Web median | Web/native time |
| --- | --- | --- | --- |
| 768x768, 10 seconds | 0.891s | 2.224s | 2.50x |
| 1080x1920, 6 seconds | 2.208s | 4.425s | 2.00x |
| 1920x1080, 4 seconds, silent | 1.144s | 2.651s | 2.32x |
| 768x768, 30 seconds | 2.779s | 6.514s | 2.34x |

All 24 Photos outputs fully decode with source dimensions/frame counts and
unchanged encoded audio hashes (silent sources remain silent). First-run native
initialization varies: the first 10-second native save took 2.681s, versus 2.514s
for web; subsequent native saves were 0.841s/0.891s. The table reports medians,
not guaranteed cold-start timings. The 30-second outputs retain all 729 frames.

This compares current product settings, not equal-quality encoder limits:
the 10-second native output is 7,519,493 bytes at roughly 5.74 Mbps video,
while web is 1,744,122 bytes at roughly 1.18 Mbps. Web encoding currently takes
longer despite the smaller output. Its benefit is avoiding a native release,
not a demonstrated speed improvement. Both image paths already use Canvas.
Physical-device performance, memory and thermal behavior remain unmeasured.

Raw rounds, input/output probes, audio hashes, Photos paths and full-decode
results: `/tmp/makaron-watermark-ab-result.json`. Reusable temporary harnesses:
`/tmp/makaron-watermark-ab.ts`, `/tmp/makaron-build-watermark-ab.mjs`,
`/tmp/makaron-collect-watermark-ab.mjs`. The A/B temporarily installed the
existing candidate only on the owned QA Simulator; the unmodified old Release
baseline was restored afterward. No source implementation or production change
was made for this comparison.

### Native iOS

#### Versioned Routing

New native builds advertise immutable `window.__MAKARON_NATIVE_MEDIA__` at
document start in the main frame. The descriptor contains `protocolVersion: 1`,
`watermarkedVideo: true` and informational App version/build strings. Web checks
both the native bridge and this supported protocol/capability before selecting
`saveWatermarkedVideoToPhotos`. App version/UA alone never proves capability.
Old shells advertise nothing and default to web encoding without probing an
unsupported action or waiting for a native timeout. Browsers also use web.
Native failures/cancellation remain failures; neither path falls back to a clean
free download. Paid originals and image behavior are unchanged.

The initial generic Mediabunny conversion stalled around 2% in WKWebView,
including the released iOS 27 Simulator. Its WebCodecs encoder retained four
queued frames while the conversion waited for queue backpressure. The selected
web-only fix uses a registered `CustomVideoEncoder`, opted in only for this
watermark source via its exact encoder configuration. It awaits a flush every
three frames before the four-frame wait, retains quality-mode encoding, closes
the encoder on cancellation, and bounds each flush to 15 seconds. There is no
global `VideoEncoder` prototype patch and no new library dependency/version.

Old-shell free video Save follows the web pipeline, then hands
the finished MP4 to the old `saveToPhotos` action. Unsupported exports show the
localized Save error and never fall back to a clean free save. No server-side
watermark composition or video encoding is needed. The earlier candidate
`saveWatermarkedVideoToPhotos` AVFoundation action is selected only when the new
shell advertises support; it is not a prerequisite for enabling old-shell Save.

The old App saves images by JPEG recompression: the new web watermark survives,
but original PNG bytes/transparency are not retained. The candidate native
PNG/JPEG byte-retention enhancement would require a separate iOS release and is
not required for this watermark path. Existing upload/picker normalization stays
unchanged.

The earlier installed iOS 27 beta blocked Capacitor's document-start synchronous prompts
for its Cookies and HTTP configuration flags. The native shell supplies those two
read-only values before the Capacitor script, only on iOS 27+, and restores the
ordinary prompt function after both reads. Other prompts retain their delegate.
On that candidate, registration and purchase UI render; four focused script tests cover
the flag values, delegation and restoration. Earlier iOS versions use the existing
WebView initialization without this script.

On the official iOS 27.0 runtime `24A434`, the unmodified old native baseline
loaded the production homepage on three consecutive cold launches and saved an
original image. The beta initialization workaround is not an established
production incident fix or a prerequisite for this web-only rollout.

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

### Phone Preview Handoff

#### Refreshed Preview With Latest Dev

- On 2026-10-01, `dev` at `7a7ca352` was merged into this candidate in
  `43b2a607`; web watermark/version routing was committed in `96dd7504`.
- Build-based launch consent control was added in `ff7cb15c`. The uploaded
  runtime snapshot is that commit, including the latest creative homepage and
  project-entry improvements. Ten unrelated dirty provider/H3 files were excluded.
- Current phone Preview: `https://ai-image-editor-7bumv1qq6-vegekyd-sys-projects.vercel.app/home`.
  Deployment `dpl_FFsrMfZqaDHgHpSznWeQHpgoyGMK` is Preview/Ready; remote optimized
  build and TypeScript checks passed. No production deployment or shared alias/env
  update was performed.
- Single-deployment configuration retains free media, verified Apple Sandbox
  media access, and Sandbox receipt verification, explicitly disables local
  Xcode media access, and sets `IOS_AI_CONSENT_REQUIRED_BUILDS=18`. Build 17 omits
  the launch page; build 18 retains it. No consent grant is written by omission.
- App Store Connect browser inspection confirmed 1.0.8 (17) is deliverable and
  the latest TestFlight build is 17, testing in both existing groups. Build 18 is
  reserved as a provisional future submission target, not uploaded by this task.
  The browser also showed the updated developer agreement requires review;
  no agreement was accepted or changed by this task.
- Unchanged old native source from `dev` was built in a new temporary staging
  folder. It is still 1.0.8 (17), development-signed, with no native media capability
  declaration, and points only to this Preview. The prior test package was replaced
  on Tianyi's physical iPhone 17 Pro; device app inventory confirms the version.
- Physical launch succeeded after unlock. Console confirms the actual Preview
  `/home`, `build:17`, `requiredBuilds:18`, and `promptRequired:false`. A read-only
  QuickTime phone-screen preview visibly confirmed the new creative homepage,
  rendered hero media, and absence of the launch consent page. No recording was made.
- The launch console also contains one early `JS Eval error` without a stack
  trace, alongside StoreKit updates without a pending web request and SDK logs.
  The subsequent Preview boot and visible homepage succeeded; this is not a
  zero-error-console claim or evidence of a completed new purchase.
- iOS regression: 157 tests in 25 suites passed. Home/project-entry/watermark and
  readiness regression: 95 tests in 14 suites passed (18 readiness tests overlap
  the iOS run). TypeScript, focused ESLint, i18n, and owned diff whitespace checks passed.
- Evidence: `/tmp/makaron-watermark-phone-refresh-stage.json`,
  `/tmp/makaron-watermark-phone-refresh-install.json`,
  `/tmp/makaron-watermark-phone-refresh-launch.log`. Installed build artifact:
  `/tmp/makaron-watermark-phone-refresh-derived/Build/Products/Debug-iphoneos/App.app`.
- Physical watermark Save, clean original Save after real Sandbox purchase, and
  Restore acceptance remain user testing, not implied by successful installation.

Consent policy and the review boundary are documented in
`docs/ios-ai-consent-build-policy.md`. Production remains unchanged pending the
user's phone acceptance.

#### Initial Preview Before Dev Synchronization

- Dedicated deployment: `https://ai-image-editor-9b2af8917-vegekyd-sys-projects.vercel.app/home`.
- Vercel identity: `dpl_AYMYgRyX13zZxnAwDNTHGXNMzijD`, target Preview, Ready.
- The upload was staged from candidate HEAD plus only watermark/version-routing
  files; unrelated dirty provider/H3 changes were excluded. The remote production
  build and TypeScript checks passed. No shared Preview variables or aliases changed.
- Per-deployment flags enable free media and `MAKARON_PREVIEW_APPLE_MEDIA_ACCESS=1`;
  Apple verification is limited to genuine `Sandbox` receipts. The Preview-only
  entitlement flag permits completed positive-value verified Sandbox purchase
  rows for clean downloads. Outside `VERCEL_ENV=preview` it fails closed. No
  Xcode/unsigned receipts are accepted; production entitlement policy is unchanged.
- Preview and production use the shared Supabase project. Tester signup/Sandbox
  purchases therefore write actual account/ledger data in that project, with the
  Apple environment recorded as Sandbox. No ledger fixtures, resets or synthetic
  purchases were applied during this handoff. Stripe Preview configuration is
  not a test-mode guarantee; phone acceptance should use Apple Sandbox only.
- A read-only check against existing verified Sandbox purchase rows also passed:
  a Sandbox-only account is eligible with the Preview opt-in and not eligible
  under production policy. No account impersonation/login or database writes
  were needed. Evidence: `/tmp/makaron-preview-entitlement-check.json`.
- An unchanged old native 1.0.8 Build 17 source was copied into an isolated
  temporary staging folder. Only its generated Capacitor URL points to this
  Preview, with production fallback disabled. It declares no new media protocol,
  so the installed phone app genuinely follows the old-shell web path.
- Debug development build succeeded and installed on Tianyi's wired iPhone 17 Pro,
  physical iOS 27.0 build `24A437`. Device app inventory confirms 1.0.8 (17).
  The initial automated launch was rejected because the phone was locked;
  physical launch/media/Sandbox purchase acceptance remains pending user testing.
- Browser loaded the actual Preview homepage and a rendered screenshot was
  inspected. Logged unauthenticated subscription-usage 401 and local-network
  address-space/CORS failures for some cover videos are not counted as a clean
  browser console or full media acceptance.
- Version-route/Sandbox/save/encoder tests passed 48 cases; iOS regression passed
  138 tests in 24 suites. Type checking, focused ESLint and i18n passed. The new
  native capability-advertisement build also compiled on the Simulator.
- Install/launch evidence: `/tmp/makaron-watermark-phone-install.json`,
  `/tmp/makaron-watermark-phone-launch.log`. Phone build:
  `/tmp/makaron-watermark-preview-phone-derived/Build/Products/Debug-iphoneos/App.app`.
  Source/upload manifest: `/tmp/makaron-watermark-preview-stage.json`.

User handoff: first save an image and a video using an unpaid account and confirm
the white watermark in Photos; then use Apple Sandbox to top up/subscribe,
return to Save and confirm the clean original. Cancellation, repeated Save and
Restore should also be checked. No production publication is authorized until
the user confirms this phone acceptance.

### Web-only Save on the Old Native Baseline

Verified on 2026-10-01 using the released iOS 27.0 Simulator runtime `24A434`
and device `82B3B260-7CE8-4D0A-8A13-00FA4A2C6B32`. The Release app was rebuilt
from the unchanged old native source matching 1.0.8 Build 17 release preparation,
with the installed Xcode 27 SDK. It is not the downloaded App Store binary.
The real candidate `SaveMediaDialog` and encoder were injected into its production
WebView for isolated QA, with retained media and a QA-only purchase-check stub.
Buttons were invoked through the component DOM; physical trusted touches,
authenticated production Editor usage and real payment sheets were not tested.
No new native binary/action was installed or called.

| Sample | Actual Photos resource | Result |
| --- | --- | --- |
| Real provider 10-second 768x768 video | `IMG_0008.MP4`, `IMG_0009.MP4` | 243 frames, full decode, original AAC packet hash; initial encode 3.076s, encode + save 3.505s |
| Cancel active encode, reopen and retry | `IMG_0010.MP4` | Canceled request made no Photos save; retry succeeded |
| 1080x1920 portrait, 6 seconds | `IMG_0011.MP4` | 180 frames, full decode, unchanged AAC packet hash; 5.847s from open including 1s before Save |
| 1920x1080 landscape, 4 seconds, silent | `IMG_0012.MP4` | 120 frames, full decode, no audio track; 4.123s including 1s before Save |
| Canvas-watermarked 768x1024 image | `IMG_0013.JPG` | Old image bridge saved successfully; JPEG visually inspected with bottom-right mark |
| QA-paid original video | `IMG_0014.MP4` | SHA-256 identical to original; no watermark encode |
| 30-second 768x768 video | `IMG_0015.MP4` | 729 frames, full decode, unchanged AAC packet hash; 8.164s including 1s before Save |

All resources are in the owned device's `data/Media/DCIM/100APPLE` directory.
Native logs confirm only the existing `saveToPhotos` action. Decoded frames show
the bottom-right signature. The 10-second web output has PSNR 37.398dB outside
the mark across all 243 frames; watermark encoding changes video bytes/quality,
unlike the paid original path. These Simulator timings are not physical-device
performance guarantees. Additional media/browser evidence is in
`/tmp/makaron-web-watermark-qa-evidence`.

Full isolated browser save acceptance also passed after this change, covering
registration/OTP/welcome credits, seven image cases, six video aspect ratios,
decoding/audio/color, three viewport sizes,
local delayed-purchase returns, paid originals and refunded access. The first run
stopped on a responsive geometry assertion despite a correctly positioned
watermark in the failure screenshot; the test now waits two animation
frames and reads both boxes atomically, retaining the same strict geometry
assertions. Passing evidence: `/tmp/makaron-free-media-e2e-1790839313150/result.json`.
Payment rows are local deterministic fixtures, not live Stripe/Apple purchases.
The browser also logged HTTP 403 console messages, while the harness's monitored
application HTTP errors were empty. This is Save/download acceptance, not a
claim that every application request or console diagnostic is error-free.

Final encoder/Save/old-bridge regression passed 55 tests in five suites; iOS
TypeScript regression passed 136 tests in 23 suites. Type checking, targeted
ESLint and the UI localization guard passed. The historical
native/StoreKit acceptance below covers the earlier native candidate, not this
old-binary web-only QA run. No production rollout has been performed.

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
