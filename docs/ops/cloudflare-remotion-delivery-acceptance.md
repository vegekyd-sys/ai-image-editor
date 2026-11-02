# Cloudflare Remotion delivery acceptance — 2026-11-03

Status: Candidate only. No production CDN routes, production application deployment, shared dev alias promotion, original-file migration, or paid-plan purchase has occurred. Supabase remains authoritative. The S3 source-cache prototype is preserved separately and is not part of this branch.

## Measured result

The initial version-pinned edge-body candidate completed 32 real-project renders with matching decoded frame and PCM hashes. Full API replay then exposed additional latency and one HTTP 502. A bounded upstream gateway retry was added; a later range-proxy candidate used a private R2 pool in Eastern North America.

For that later candidate, the 15.23-second 1080×1920 project produced:

| Measurement | Original source | R2 range proxy |
|---|---:|---:|
| Direct Lambda A/B median, 4 per mode | 8.173 s | 8.339 s |
| Direct Lambda maximum | 9.217 s | 16.356 s |
| Full API A/B median, 4 per mode | 10.624 s | 13.614 s |
| Full API maximum | 23.215 s | 16.732 s |

All eight direct Lambda outputs matched in decoded frames and audio. A complete 29,147,721-byte Range read from the private R2 replica matched the source SHA-256 `9287e40a08104cb324fb6091f9124606fb7ccee2610d4f31a87bca9f933de765`. The full API median regressed by approximately 28%, so this candidate is **not accepted for production migration**. Cold and warm runtime variation exists in both modes; the outliers must not be removed to claim a speed gain.

Subsequent complete decoding of the eight full API outputs found four identical baseline results, three matching Cloudflare results, and one Cloudflare result with different frame and PCM hashes. The divergent sample is retained in the private acceptance receipts. Its cause is unresolved. This is an additional quality rejection; matching source bytes and a passing direct-render comparison do not establish full API quality acceptance.

The source-map implementation keeps authored code, props, visible URL text and font input unchanged. The first extra-wrapper experiments experienced frame-extraction timeouts and were rejected. The current optional runtime applies source mapping within existing media wrappers, with a stable serialized map and unchanged decoder/encoding/concurrency settings. The ordinary application contract remains compatible with the candidate site when overrides are absent.

## Native delivery candidate

The next candidate prepares native R2 S3-compatible temporary GET URLs instead of proxying media bodies through a Worker. It is disabled without separate read-only cache credentials and has **not** been validated against live native R2 access or production exports.

The fixed scope is the private `makaron-render-media-cache` bucket. A read key must not access Scene or other buckets. Native URLs expire within six hours and contain no secret access key. Before selecting a native URL, an authenticated one-byte GET checks the stored source-version proof and complete size. Unready sources retain Supabase; copies never own current-export latency. The existing Worker can asynchronously warm the separate `v1/native/` namespace.

Native readiness also rejects copies older than six days, leaving a full day of margin before the seven-day cache lifecycle can remove the object. This avoids issuing a six-hour URL just before predictable object expiry. Prepared native/Worker URL counts are recorded separately from early probe counts; these are diagnostic counts, not a billing meter.

The required credential action has been presented for explicit confirmation. No new R2 read credential has been created. Candidate code and local tests can proceed independently; native cloud requests and deployment activation must wait for that confirmation.

## Resources and remaining gates

- Worker: `makaron-media-delivery`; candidate domain: `media-cache.makaron.app`. Production `cdn.makaron.app` routes remain untouched.
- Private cache pools: `makaron-public-media-cache` and `makaron-render-media-cache`, both with seven-day `v1/` expiry. The render pool location was read back as Eastern North America. Public bucket URLs remain disabled.
- Candidate Lambda sites are separate `makaron-media-transport-20261103-v1`, `v2`, and `v3` sites. No production serve URL or either shared sandbox snapshot ID was changed.
- Private comparison receipts and playback page assets are under operator temporary directories. Secrets are excluded from this document and Git. The loopback QA server serves a separate public-only directory.
- CLI registry parity: all nine packaged files of `makaron-cli@0.17.7` match this checkout. This infrastructure candidate adds no CLI command, parameter, help or bundled Skill change.

After confirmation: configure only scoped read credentials/CORS, validate native full bytes and browser Range playback, repeat alternating real-project Lambda and full API comparisons, and accept only a candidate meeting the user's speed/quality requirement. Remove the Preview-only acceptance endpoint before any production release. Production, dev and shared Preview synchronization and live export verification remain required after an accepted release.

Billing savings are forecasts until actual Supabase plus Cloudflare usage is reconciled. The screenshot's USD 204.15 is an upcoming-cycle snapshot, not a refunded amount. No achieved monthly saving is claimed here.
