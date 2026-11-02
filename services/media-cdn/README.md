# Makaron public media delivery

Supabase remains authoritative. This Worker serves original bytes through a private R2 replica and an edge cache. It does not encode, resize, or replace authored source URLs. The earlier prototype is preserved in Git commit `b5f4d581`.

## Deployment boundaries

- Candidate Worker: `makaron-media-delivery`; candidate domain: `media-cache.makaron.app`.
- Private bucket: `makaron-public-media-cache`, separate from Scene. No R2 public URL or bucket domain is enabled. Existing Worker bindings avoid new long-lived storage credentials.
- Production `cdn.makaron.app` routes are a separate promotion step after quality and speed acceptance. This config intentionally contains no production routes.
- `v1/` replicas expire after seven days. The policy was read back in the Cloudflare dashboard on 2026-11-02. Supabase originals are untouched.
- Production and Scene share account-level free allowances; this is not a separate free quota for each bucket. No paid plan is purchased by the deploy command.

## Request contract

Only anonymous GET/HEAD public object/image-transform paths with media MIME, a strong ETag and a known length are cached. Signed/private URLs, credentials, cookies, nonmedia, unsupported ranges and private GET policies bypass the shared cache. Other requests preserve their origin behavior.

Supabase can return `private, no-cache` for HEAD while an anonymous GET is public. In that case a one-byte Range GET validates the actual GET policy and complete size. A private GET or an ignored Range probe never enters the cache. Versioned keys include the complete source URL, Accept variant, ETag and size. Metadata is checked at least every 60 seconds; current origin versions select the corresponding body cache. Deletion or changed visibility stops serving the old replica after metadata revalidation.

Full cold requests stream directly from origin and independently attempt one R2 fill. Ready edge requests use cached original bytes. A cold edge streams the original Supabase path while R2 warms asynchronously; regional R2 latency never owns the client response. Native streams preserve response length and avoid JavaScript processing per chunk. Single ranges, suffix ranges, If-Range, If-Match, conditional GET and HEAD are supported. Optional cache failures fall back to origin.

## Cost and runtime limits

A successful cold fill costs one additional complete origin read; a small Range can trigger that fill. A distributed conditional lease suppresses concurrent fills for 90 seconds. Therefore savings depend on reuse within retention, not just on moving the hostname. Failure/expiry can require another copy. Seven-day retention reduces daily recopying at the cost of more R2 storage.

Background work has at most 30 seconds after the client response ends. Objects above 5 GiB bypass R2 in this implementation; bodies above 500 MiB bypass the edge cache. Cache API is local to a Cloudflare location. These limits and cold-cache speed must be measured before production promotion.

The Workers Free allowance is account-wide, 100,000 invocations/day. Production routes must use fail-open behavior so quota exhaustion returns to the original Supabase path. This does not promise a particular saving under request-limit exhaustion. A paid account upgrade requires its own checkout and is not performed here.

## Validation

```sh
node --test services/media-cdn/test/worker.test.mjs
npx tsx benchmarks/remotion-delivery-acceptance.ts --cloud --env-file <private-env> --delivery-env-file <private-gateway-env> --design-json <private-design> --owner-id <owner> --output-dir <private-results>
```

The real-project runner applies the existing media compatibility stage before transport routing. It compares the exact current Lambda runtime and encoding settings in alternating order, verifies source SHA-256, decoded frames and PCM, and retains playable samples. Source copies and decoded-output checks run in a disposable cloud VM; only results and selected samples return to the operator. Cloud credentials are never passed into the VM. Export timing excludes validation/download work.

No CLI/API command or product UI contract changes. The optional `REMOTION_MEDIA_DELIVERY_ORIGIN` flag and matching app `REMOTION_MEDIA_DELIVERY_SECRET` / Worker `RENDER_SIGNING_SECRET` enable render-only version capabilities. One anonymous one-byte GET checks the current strong ETag, size, MIME and public-cache policy. Start this during existing job lookup/insert/claim and composition preparation, deduplicated in an owner/project/fingerprint-scoped process cache (64 plans, 30-second reuse limit). At render submission, consume only completed probes; unfinished sources receive an origin-only capability without waiting.

All frame workers reuse the same validated version. HMAC is verified before any edge hit, is bound to the canonical source URL and version, and expires within six hours. Tokens are stable within an hour for browser reuse. Tokens are removed before origin requests and never enter saved compositions; cloud account credentials never reach frame workers. Private/provider URLs remain unchanged. Capabilities assert a public media version; they do not make public source objects private. Query-string logging is redacted.

Ordinary playback/download metadata revalidates within 60 seconds. Versioned edge bodies can live for a day; current metadata chooses the matching version. Browser freshness follows the original policy up to one hour. Source CSP and nosniff protections are retained.

The temporary Preview-only `/api/internal/remotion-delivery-acceptance` operator harness is gated by a separate secret and explicit Preview-only enable flag. It creates unpublished, uniquely marked export jobs and uses the real queue/renderer/publishing pipeline. Remove this route before production promotion. Keep `REMOTION_EXPORT_SOURCE_CACHE` off: the earlier S3 candidate is not part of this Cloudflare rollout.

## Rollback

Remove only the new public-media routes and unset `REMOTION_MEDIA_DELIVERY_ORIGIN`. Retain the previous route IDs/configuration in the private release receipt. Do not change Supabase Auth/REST routes, DNS origin, existing image-transform parameters, Scene credentials, source objects or saved compositions.
