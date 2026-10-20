# Public media cache candidate

This is an isolated candidate, not a production route. Supabase remains the source of truth. No historical objects are copied in bulk, and no Supabase key is used.

## Request contract

- Eligible: anonymous GET/HEAD to `/storage/v1/object/public/<bucket>/<path>` and `/storage/v1/render/image/public/<bucket>/<path>`, with image/video/audio MIME, strong ETag, known size, at most 5 GiB.
- Everything else passes through: signed/private paths, API calls, credentials/cookies, token query parameters, nonmedia, errors, unsupported metadata, private/no-store responses.
- Supabase's `__cf_bm` and `_cfuvid` infrastructure cookies are removed on cached responses. Any other origin cookie prevents caching.
- Origin HEAD validates the version. `no-cache` or `max-age=0` sources are checked on every request; other metadata lasts at most 60 seconds. R2 keys include the complete URL, Accept variant, ETag and size. Updated sources use new objects; deleted/private sources stop being served after metadata revalidation.
- Full cold GET streams bytes to the client and R2 with bounded backpressure. Cold Range responds immediately and attempts a full background fill. Duplicate background fills are suppressed within one isolate, not globally.
- Warm responses come from edge cache or R2. Single byte ranges, suffix ranges, conditional GET, If-Match and If-Range are supported. Failures fall back to origin.
- Cache API is local to each Cloudflare location and is **not** Tiered Cache. The separate Smart Tiered Cache account setting does not make this worker tiered.

## Limits requiring cloud validation

A background fill has only Cloudflare's remaining `waitUntil` lifetime (normally 30 seconds after the response ends). A large cold Range request may not fill its entire file before that limit. Full GET copying lasts while the client is connected. Objects above 5 GiB bypass this implementation; edge bodies above 500 MiB use R2 without Cache API.

Cold Range can increase origin bytes: requested ranges plus one full copy. Concurrent isolates can duplicate that copy. Do not claim origin savings from cold requests. Capture complete cold/warm runs and logs; compare identical file hashes.

The candidate bucket should have a one-day expiry for `v1/` replicas before broader tests. This is a cache retention policy, not a source-data lifecycle. No lifecycle has been applied yet. Keep measured test storage below 1 GiB; do not broaden traffic before retention is configured.

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

- Worker logic: 14 tests pass, including fallback, conditions, versioning, no-cache and infrastructure-cookie handling.
- Workerd local runtime against a real 19,726,445-byte Supabase MP4: cold MISS downloaded exact source bytes; warm full HIT and Range HIT; only the cold run logged an origin GET. SHA-256 `a393f0c381180afd71392ade7d554d3b250b313336e8bbe411904598e24368d7`.
- Local cache timings are not cloud-network speed evidence and are excluded from speed claims.
- Browser, same 142,048,671-byte source: candidate four-way 20.4249 s; single-way 20.4782 s. Both exact SHA-256. No material gain in this sample. Earlier different-time samples showed larger gains and must remain separate.
- Editor original-save integration and download regression: 40 tests pass; type checking and focused lint pass.
- Cloudflare candidate name `makaron-media-cdn` exists but currently contains only the initial Hello World placeholder. No media worker was deployed, no R2 binding attached, no production route changed. Dashboard editor did not finish loading; Wrangler OAuth requires explicit access approval and its initial attempt expired.
- Public image coverage, real cloud cold/warm measurements, multi-location behavior, CPU/time limits, retention and a production decision remain open.

## Rollback

Before production there is no user traffic to roll back. If approved later, attach only the existing public media paths on `cdn.makaron.app` with fail-open behavior, verify them, and retain the exact previous configuration. Rollback removes those Worker routes and restores the original cache bypass. Supabase objects and URLs are never modified by this service.
