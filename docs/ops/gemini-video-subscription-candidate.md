# Administrator video subscription candidate

This is a disabled client candidate, not a working production Relay integration.
The existing Scene service advertises `video_analysis`, which accepts a different
JSON / temperature / frame-rate recipe. It does **not** implement the capability
or endpoints below. Upgrading Scene's model alias alone does not satisfy this
contract. Do not enable this client against that service.

## Application behavior

- `GEMINI_VIDEO_RELAY_ENABLED` defaults to off. When off, no role lookup or Relay
  request is added. All callers keep the existing API input, model override,
  processing mode, size limit and billing behavior.
- When enabled, only a fresh `user_profiles.is_admin = true` can grant access.
  Shared personal-plan membership, owner environment variables and request-supplied
  metadata cannot grant administrator status. Role lookup is bounded to 1.5s;
  lookup errors/timeouts keep the API path.
- Only static processing with requested `gemini-3.8-flash` is eligible. Explicit
  model overrides and agentic requests keep the original API path.
- Eligible sources are HTTPS object URLs at the configured Supabase hostname or
  `cdn.makaron.app`, plus the published `/home-hero/*.mp4|webm` first-party fixtures.
  Other inputs, including YouTube and existing Google Files, keep the API path.
- Relay preflight is bounded to 2s. A missing capability, mismatched recipe,
  stale quota or exhausted allowance falls back **before** any job submission.
- Job submission happens once. A lost acknowledgement recovers by GET of that
  exact job ID. Unknown outcomes, unverifiable receipts and content rejection
  fail closed; they never resubmit or use another provider. A confirmed terminal
  pre-generation failure can use the API only with a recognized safe error code
  and `generator_submissions = 0`.
- Preflight, polling, download and inference share the existing 120s analysis
  budget. This intentionally does not extend the product's time or size limits.

## Private configuration

No credentials belong in this document, `.env.example` values, test snapshots or
client bundles.

| Variable | Meaning |
| --- | --- |
| `GEMINI_VIDEO_RELAY_ENABLED` | Explicit `true` after service and quality acceptance |
| `GEMINI_VIDEO_RELAY_URL` | HTTPS service base; HTTP is allowed only for loopback tests |
| `GEMINI_VIDEO_RELAY_SECRET` | HMAC secret, at least 32 characters |
| `GEMINI_VIDEO_RELAY_OWNER_ID` | Existing verified service owner identity; not caller role authorization |
| `VIDEO_ANALYSIS_GOOGLE_API_KEY` | Optional video-specific fallback key; otherwise `GOOGLE_API_KEY` |

The service-owner signature authenticates the trusted Makaron application. The
application separately checks the authenticated caller's current administrator
role. The extension must remain isolated from Scene membership management and
must not expand any existing Relay allowlist. Never publish the shared secret
or give it to browser/CLI clients.

API results now keep `requestedModel` and provider-reported `reportedModel`
separate. An absent reported identity is not treated as proof of actual identity.
API token pricing continues to use the requested rate-table alias. A verified
subscription result records actual model plus `:gemini-subscription` in
`usage_logs`, with zero **Makaron credits** and existing run/project/source
attribution. That is not a claim that a paid subscription, Cloud Run or storage
costs nothing. Structured server logs include the application, operation,
modality, route, requested/reported models, token categories and fallback reason;
they omit prompts, source URLs, credentials and user IDs.

## Proposed independent service extension (not implemented by this PR)

Keep this capability separate from Scene's JSON recipe. A service must advertise
the following in its signed `/v1/status` response before Makaron submits anything:

```json
{
  "capabilities": ["makaron_video_analysis"],
  "makaron_video_analysis": {
    "version": 1,
    "model": "gemini-3.8-flash",
    "processing": "static",
    "thinking": "low",
    "input": "cloud-source-url",
    "output": "text",
    "source_unmodified": true,
    "max_source_bytes": 38500000
  }
}
```

The response also needs `available = true`, a fresh `quota.checked_at` (seconds),
and exactly the `gemini-weekly` and `gemini-5h` buckets with positive remaining
fractions and future reset times. The service must recheck allowance at admission
instead of trusting client preflight.

`POST /v1/makaron-video-jobs` receives canonical UTF-8 JSON containing:

```text
operation = makaron_video_analysis
job_id = client-generated UUID
model = gemini-3.8-flash
user_id = server-authenticated current administrator (attribution only)
source_url = authorized HTTPS media reference
max_source_bytes = 38500000
question = original user question, or existing default description prompt
processing = static
thinking = low
timeout_ms = remaining analysis budget
```

Reuse the existing `x-scene-relay-*` HMAC headers and seconds timestamp. Sign:

```text
METHOD + newline + actual pathname + newline + timestamp + newline
+ request UUID + newline + verified service owner + newline + SHA256(body)
```

Canonical JSON sorts object keys recursively, emits UTF-8 without ASCII escaping,
and uses compact separators. Admission returns `{state: "ACCEPTED", job_id}`;
GET `/v1/makaron-video-jobs/{job_id}` must enforce the same owner and return an
explicit state and job ID. Persist admission **before** any provider submission.
Bind reuse to both owner and full request digest; never execute a conflicting
reuse of an ID. A failed job/GET must include `generator_submissions` so an unknown
result cannot masquerade as a safe pre-generation failure.

The Cloud worker must:

1. Authenticate private cloud transport using existing reviewed Google identity
   plumbing. Validate trusted source hosts, object paths, redirects and size
   before downloading. Do not enable arbitrary URL fetching or proxy access.
2. Download complete original bytes in Google Cloud. V receives metadata only.
   Preserve the original dimensions, timeline and audio. Do not reuse Scene's
   large-file transcode, fps=4, temperature=.1 or forced JSON settings.
3. Measure container duration, prepend exactly the same measured-duration and
   opening/ending-framing instruction as `video-analysis.ts`, and submit the
   unmodified user question. Apply the existing static/LOW configuration without
   new temperature, schema, frame sampling or output truncation overrides.
4. Validate model, STOP, nonempty non-thinking text, usage and raw billing
   evidence. Never convert a missing billing field into a verified zero. Content
   blocking, unknown outcome or paid-credit consumption must fail closed.
5. Persist a receipt bound to the canonical client payload. It must contain:

```text
request_sha256, requested_model, model, account_model
transport = antigravity-native-account
billing = subscription-allowance
consumed_credits = verified numeric zero
finish_reason = STOP
processing = static; thinking = low
generator_submissions = 1; media_on_v = false
analysis = complete free text
usage = nonnegative integer Google token categories
source = {prepared: false, source_bytes, input_bytes,
          source_sha256, input_sha256, duration_seconds}
```

The client requires source/input byte counts and SHA256 values to agree. It only
admits actual identities `gemini-3.8-flash` or `gemini-3.8-flash-n` under the
observed account selector `gemini-3.8-flash-medium`. These are explicit identities,
not proof that the API and subscription backends have identical behavior.

The extension needs its own service review and deployment, durable receipt
retention/recovery, source authorization, authenticated Cloud transport and
quota validation. None is replaced by the client mocks in this PR.

## Validation and release gates

Local regression covers ordinary/anonymous/administrator behavior, disabled
configuration, stale quota, incompatible Scene capability, unsafe URLs, explicit
recipe overrides, signatures, wrong/billed/truncated/transformed receipts,
content rejection, late role results, lost acknowledgements, unknown jobs and
zero-credit subscription versus normal API accounting with run attribution.

The explicit paid smoke script uses three already-published first-party videos:

```sh
node --env-file=/private/path/to/credentials.env --import tsx \
  scripts/check-gemini-video-relay.ts --run-api --compare-current
```

It requires an existing administrator in `GEMINI_VIDEO_RELAY_TEST_USER_ID`, writes
local evidence, and does not write product balances or usage rows. Without
`--run-api` it makes no model requests. `provider=google-api` after preflight is
an API fallback result, never a successful Relay comparison.

Before rollout, compare repeated direct-API and **real subscription** runs on the
same original videos and prompts, including long input, OCR, timeline/camera
changes, dialogue and verified silent input. Check silence explicitly: the
current API smoke can invent background music on silent fixtures. Freeze source
hashes and compare factual quality, p50/p95, cold/warm paths, concurrency,
subscription allowance and every fallback class. Local Mac latency is not
production Vercel latency. A few short API-only samples establish neither
non-regression nor savings.

Verify real `chat → analyze_video`, standalone MCP/CLI and administrator ledger
rows before enabling. Check ordinary-user behavior and rollback by disabling the
feature. Follow the normal release/CLI parity workflow only after the service
extension and these gates pass. This PR does not change production variables,
deploy the Relay, rotate/revoke shared keys, publish CLI, change image models or
change embeddings.
