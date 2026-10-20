# Public media cache candidate

This is an isolated candidate, not a production route. Supabase remains the source of truth. No historical objects are copied in bulk, and no Supabase key is used.

## Request contract

- Eligible: anonymous GET/HEAD to `/storage/v1/object/public/<bucket>/<path>` and `/storage/v1/render/image/public/<bucket>/<path>`, with image/video/audio MIME, strong ETag, known size, at most 5 GiB.
- Everything else passes through: signed/private paths, API calls, credentials/cookies, token query parameters, nonmedia, errors, unsupported metadata, private/no-store responses.
- Supabase's `__cf_bm` and `_cfuvid` infrastructure cookies are removed on cached responses. Any other origin cookie prevents caching.
- Origin HEAD validates the version. `no-cache` or `max-age=0` sources are checked on every request; other metadata lasts at most 60 seconds. R2 keys include the complete URL, Accept variant, ETag and size. Updated sources use new objects; deleted/private sources stop being served after metadata revalidation.
- Full cold GET streams natively to the client and starts a separate native R2 fill. Cold Range responds immediately and attempts the same fill. A conditional R2 lease suppresses duplicate fills across isolates for 90 seconds; a small in-isolate map also coalesces requests. No JavaScript byte pump runs per body chunk.
- Warm responses come from edge cache or R2. Single byte ranges, suffix ranges, conditional GET, If-Match and If-Range are supported. Failures fall back to origin.
- Cache API is local to each Cloudflare location and is **not** Tiered Cache. The separate Smart Tiered Cache account setting does not make this worker tiered.

## Limits and measured costs

A background fill has only Cloudflare's remaining `waitUntil` lifetime (normally 30 seconds after the response ends). A large cold Range request may not fill its entire file before that limit. Native client streaming lasts while the client is connected; a failed replica write does not own or truncate that response. Objects above 5 GiB bypass this implementation; edge bodies above 500 MiB use R2 without Cache API.

A cold full GET costs up to two complete origin reads (client plus replica). Cold Range costs the requested ranges plus one full copy. An expired lease or failed fill can require another attempt; a 1-byte Range probe may initiate a whole-file fill even if the client stops. For successful fills and repeated complete reads within retention, origin body bytes break even on the second read and fall by 33% after three reads, 80% after ten. HEAD validation and response headers still use origin requests/bytes. These are body-byte measurements, not invoice savings. A 1-day retention can reset this break-even each day.

The private `makaron-public-media-cache` bucket has the enabled `Candidate cache expiry 1 day` lifecycle for `v1/`. Original Supabase objects are untouched. The test working set is below 1 GiB; R2 usage reporting is delayed, so this is a measured file total, not a current billing reading.

## Development

```sh
cd services/media-cdn
npm ci
npm test
npx wrangler dev --local --port 8794
npx wrangler deploy --dry-run
```

`wrangler.jsonc` intentionally contains no routes. `workers_dev` is the candidate endpoint. Production attachment requires a separate, explicit release decision after cloud measurements. Existing production cache bypass remains unchanged.

The local benchmark UI is `services/media-cdn/bench/index.html`, served by Vite from the repository root. It imports the same TypeScript downloader used by the Makaron editor. Do not ship this diagnostic UI in the product.

For cloud comparison:

```sh
node benchmark.mjs /path/to/manifest.json https://makaron-media-cdn.vegekyd.workers.dev /tmp/cdn-comparison
```

The benchmark runs serially across baseline/cold/warm and validates four Range responses before hashing the assembled file. Origin logs contain hashed resource identifiers, methods, status and declared response byte counts, never source URLs or credentials. Count only successfully completed measured transfers; these logs are not a substitute for the Supabase invoice. Disable `MEASURE_ORIGIN` and reduce log sampling before any production release.

## Current validation (2026-10-20)

Candidate endpoint: `https://makaron-media-cdn.vegekyd.workers.dev`. Current version: `b9b110ab-73fe-4fde-8a2b-13827b931bff`. It has the R2 binding and no production routes. Production cache bypass and DNS remain unchanged. OAuth access was explicitly approved; no production-route permission was requested.

- Worker logic: 14 tests pass, including HTTP conditions, private bypass, fallback, distributed lease and a replica-write rejection that leaves the client intact.
- Editor integration: 40 focused tests and TypeScript pass. Earlier full repository suite: 365 files, 2,525 passed, one skipped (before the last two editor tests and Worker-only fixes). Product UI copies and CLI/API capabilities are unchanged; no CLI release is needed for this candidate.
- Final cloud version: all 10 supplied MP4s downloaded fully with exactly matching source SHA-256 values. Four files were requested concurrently for integrity, so those timings are not single-download speed benchmarks.
- Original JPEG (433,683 bytes) and transformed JPEG (97,559 bytes): source, MISS, R2 and edge HIT all match. Timings show no convincing original-image gain; transformed-image 1.13 s source versus 0.86 s edge is one sample, not a network-wide guarantee.
- Controlled curl pairs used native-stream version `4869c199-ff74-4053-a6bc-9997b1e85dd6`; final version only removes chained edge warming from cold fill and adds replica-completion logging. 142,048,671 bytes: source 64.24 s, cold 66.19 s, R2 67.85 s, four ranges 17.58 s. 19,726,445 bytes: source 10.11 s, cold 10.09 s, edge HIT 9.83 s, four ranges 3.20 s. Every full/assembled checksum matches.
- Those two objects generated exactly four full origin GETs across the cold + warm + four-range runs: 323,550,232 body bytes versus 485,325,348 for three uncached complete reads (33.3% less); 13 HEADs remained. The old prototype's failed reads are separate and not included in these savings.
- Same-browser baseline against the production source earlier in the day: four-way 20.4249 s versus single 20.4782 s for 142 MB. Both hashes match, but no material gain. Do not combine this with curl results or promise a fixed speed multiplier.
- Final cloud endpoint in the same browser: single 18.903 s, four-way 18.6596 s, source single 19.2152 s. All 142 MB hashes match. This uses the editor shared module via a harness, not a complete manual editor/iPhone-save acceptance. No material browser speed gain was established.
- All measured Cloudflare rays are NRT. This does not establish mainland-China or multi-location performance. Cache API is per location; R2 is shared, but storage location and client networks affect latency.

### Rejected prototype retained as evidence

Version `30aab9be-e817-440d-886b-27984050e177` used JavaScript fan-out for full streams. It exceeded Worker CPU (2,020 ms) and returned truncated 142 MB bodies despite HTTP 200. Those transfers fail size/hash checks and are excluded from speed comparisons. Native streaming fixed this: final cloud invocations used low double-digit CPU milliseconds and all 10 files passed. The first native version completed R2 fills but could exhaust background lifetime when it then warmed the edge; the final version separates these steps.

Evidence: `../../docs/ops/cdn/cloud-native-comparison.json`, `cloud-all-video-validation.json`, `cloud-image-validation.json`, `cloud-runtime-events.json`, `cloud-browser-comparison.json`, and `makaron-browser-download.json`.

Production remains pending a decision. Repeated reads demonstrably reduce origin body traffic; speed benefits depend on the client and are largely from parallel downloading, not this cache. Free-plan request limits and one-day eviction must be considered before routing site-wide traffic. Do not market this as a proven global acceleration release.

## Rollback

Before production there is no user traffic to roll back. If approved later, attach only the existing public media paths on `cdn.makaron.app` with fail-open behavior, verify them, and retain the exact previous configuration. Rollback removes those Worker routes and restores the original cache bypass. Supabase objects and URLs are never modified by this service.
