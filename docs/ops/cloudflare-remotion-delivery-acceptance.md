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

The next candidate prepares native R2 S3-compatible temporary GET URLs instead of proxying media bodies through a Worker. It is disabled without separate read-only cache credentials. The native candidate has now been validated on isolated cloud deployments; production activation is still pending.

The fixed scope is the private `makaron-render-media-cache` bucket. A read key must not access Scene or other buckets. Native URLs expire within six hours and contain no secret access key. Before selecting a native URL, an authenticated one-byte GET checks the stored source-version proof and complete size. Unready sources retain Supabase; copies never own current-export latency. The existing Worker can asynchronously warm the separate `v1/native/` namespace.

Native readiness also rejects copies older than six days, leaving a full day of margin before the seven-day cache lifecycle can remove the object. This avoids issuing a six-hour URL just before predictable object expiry. Prepared native/Worker URL counts are recorded separately from early probe counts; these are diagnostic counts, not a billing meter.

The user explicitly approved creating the long-term single-bucket read credential on 2026-11-03. It was created as Object Read only for `makaron-render-media-cache` and stored as sensitive application-server configuration. Bucket public access remains disabled. CORS permits GET/HEAD from the Lambda site origin and the loopback QA page; no Scene credential was reused.

## Native cloud results

The same encoding, decoder, concurrency, trim and design inputs were retained. The 29,147,721-byte native R2 source matched the original SHA-256. All eight direct Lambda outputs and all 20 full API outputs had matching decoded frame and PCM hashes within their respective projects.

| Measurement | Original source | Native R2 |
|---|---:|---:|
| Direct Lambda median, video, 4 per mode | 8.994 s | 9.388 s |
| Full API median, video, 8 per mode | 10.803 s | 10.713 s |
| Full API maximum, video | 13.750 s | 18.148 s |
| Full API median, audio-heavy project, 2 per mode | 27.427 s | 13.940 s |
| Regional concurrent Range-read median, 92 per mode | 81 ms | 80 ms |
| Regional concurrent Range-read P95 | 398 ms | 159 ms |
| Regional concurrent Range-read maximum | 630 ms | 334 ms |

The regional comparison issued 23 concurrent 64 KiB ranges per batch in alternating order; all matching ranges were byte-identical. Browser playback and seeking of the native 1080×1920 source also succeeded. These checks do not establish a guarantee that every future cloud render has unchanged latency. One native full API video replay took 18.148 s; it remains in the statistics and must not be removed as an outlier to claim a stronger speed result. One of eight candidate video exports fell back to the source because the readiness deadline was reached; its quality/speed are retained in the aggregate and it is not counted as native traffic offload. The other seven used native R2.

The eight direct-render comparisons exercise ready replicas. Their preliminary priming uses unique source-query variants, so native misses in that phase fall back to Supabase; those priming timings must not be described as measurements of a cold native replica.

The temporary Preview acceptance route and internal baseline override have been removed from the production candidate. Existing immutable Preview receipts remain available privately. No achieved monthly savings or completed production migration are claimed by these candidate results.

## Resources and remaining gates

- Worker: `makaron-media-delivery`; candidate domain: `media-cache.makaron.app`. Production `cdn.makaron.app` routes remain untouched.
- Private cache pools: `makaron-public-media-cache` and `makaron-render-media-cache`, both with seven-day `v1/` expiry. The render pool location was read back as Eastern North America. Public bucket URLs remain disabled.
- Candidate Lambda sites are separate `makaron-media-transport-20261103-v1`, `v2`, `v3`, and `v4` sites. No production serve URL or either shared sandbox snapshot ID was changed.
- Private comparison receipts and playback page assets are under operator temporary directories. Secrets are excluded from this document and Git. The loopback QA server serves a separate public-only directory.
- CLI registry parity: all nine packaged files of `makaron-cli@0.17.7` match this checkout. This infrastructure candidate adds no CLI command, parameter, help or bundled Skill change.

Before production activation: run the production-candidate checks, preserve the prior deployment/configuration for rollback, and verify a live export after release. Ordinary public CDN routes have not been accepted or activated by the native-render comparison. Production, dev and shared Preview synchronization remain required after an accepted release.

Billing savings are forecasts until actual Supabase plus Cloudflare usage is reconciled. The screenshot's USD 204.15 is an upcoming-cycle snapshot, not a refunded amount. No achieved monthly saving is claimed here.
