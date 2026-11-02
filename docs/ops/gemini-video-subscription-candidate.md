# Google Relay understanding candidate (PR17)

Implemented in an isolated worktree; disabled in the application until the shared
service extension, configuration and quality gates are accepted. This is not a
production activation receipt.

## Routes and access

`GEMINI_VIDEO_RELAY_ENABLED=true` opts in. A caller must be authenticated, present
in the existing personal-plan roster, **and currently an administrator**. Codex
and Grok access rules remain separate. The same administrator page synchronizes
all enabled plan rosters, takes actual remote snapshots before writing, and
compensates attempted writes on failure. A disabled Google plan cannot block
existing Codex/Grok management. Google appears as disabled, pending, synced or
unconfirmed independently. Never equate a synchronized roster with available
subscription quota.

Eligible understanding operations are `analyze_video`, the text-only Agent image
bridge (`analyze_image`, upload/Retake inspection, design preview), frame location
and frame verification. The three legacy `gemini-3-flash-preview` helpers now use
`gemini-3.8-flash` with LOW thinking. Vision-capable Agents keep their existing
native image transport. Image generation, Tips and embeddings are unchanged.

Video routing preserves static processing, the 38.5 MB ceiling, original source
bytes, full timeline and audio. The cloud worker downloads only first-party hero
fixtures and configured Supabase/CDN object paths over HTTPS without redirects.
YouTube, existing Google Files, arbitrary hosts, explicit custom model and
agentic mode stay on the existing API path. The API and Cloud recipes share the
measured-duration and camera-framing instruction. Verified containers with no
audio track explicitly instruct the model not to invent sound.

## Shared service composition

`services/google-subscription-extension/` is an executable add-on, not a copy of
Scene's canonical server. `relay_entry.py` composes its existing `Relay` and
handler, preserving Scene owners, authorization, quota, safety, OAuth and native
account readiness. Makaron gets a separate SQLite roster and job journal. Its
control endpoints cannot edit Scene membership. Only the configured existing
service owner can access them. The Cloud worker can run as a private sibling
service or its `/makaron` routes can be mounted after shared-service review.
Neither entrypoint replaces a deployed Scene service automatically.

At both admission and execution the Relay calls the fixed trusted Makaron
`/api/internal/google-relay-authorize` endpoint. HMAC binds timestamp, user,
job UUID and request hash. The endpoint reads current roster and administrator
role; it returns no roster or personal details. The signature expires after 30s.
This read-only authorization may be repeated; it cannot authorize another job.
No Supabase credential is sent to V. The callback must target an accepted
Makaron deployment, never a URL supplied in a job.

One POST admits one durable owner + UUID + canonical payload hash. Persist before
submission, poll the same ID after a lost acknowledgement, and retain tombstones
across restart. A conflicting reuse is rejected. Cloud GCS receipt creation uses
`ifGenerationMatch=0`; it commits GENERATING before its only Google request.
Unknown outcomes, content rejection and unverifiable results do not automatically
replay or fall back to API. Only a recognized explicit rejection with verified
`generator_submissions=0` can fall back. Cloud admission failures without that
receipt remain conservative unknown outcomes.

The service receives short-lived IAM identity from Makaron's Vercel OIDC → Google
STS → IAM generateIdToken flow. Federation must trust only the intended Makaron
project/environment; configure `run.invoker` and token-creator permissions for the
specific service account. Never copy long-lived Google service-account keys or
API keys to V. V forwards its existing account OAuth only to the fixed private
Cloud URL; both workers clear it after execution and omit it from receipts/logs.
V sees image helper data, but no video bytes. Cloud receipts contain results and
hashes, not OAuth, source URLs or prompts. Use a dedicated receipt prefix with
reviewed retention; place it inside the service account’s already authorized
object prefix (for example `scene-index/gcs/makaron-subscription-receipts/`),
without widening bucket IAM. No automatic job-ID deletion/replay is implemented.

## Private settings

No values, user IDs or credentials belong in this public repository.

Application: `GEMINI_VIDEO_RELAY_ENABLED`, `GEMINI_VIDEO_RELAY_URL`,
`GEMINI_VIDEO_RELAY_SECRET`, `GEMINI_VIDEO_RELAY_OWNER_ID`,
`GEMINI_RELAY_CLOUD_URL`, `GEMINI_RELAY_WIF_PROVIDER` (full `//iam.googleapis.com/…`
provider audience), `GEMINI_RELAY_SERVICE_ACCOUNT`.
`VIDEO_ANALYSIS_GOOGLE_API_KEY` optionally isolates API fallback; otherwise use
`GOOGLE_API_KEY`.

Relay entry: existing Scene settings plus `SCENE_GEMINI_APP` (reviewed canonical
source directory), `MAKARON_GEMINI_CLOUD_URL`, `MAKARON_GEMINI_OWNER_ID`,
`MAKARON_AUTHORIZATION_URL`. For an isolated candidate use its own
`SCENE_GEMINI_STATE` and loopback port; do not mutate shared owner lists or state.

Cloud: `SCENE_GEMINI_GCS_BUCKET`, `MAKARON_RECEIPT_PREFIX`,
`MAKARON_GEMINI_OWNER_ID`, `MAKARON_STORAGE_HOST`. Require IAM authentication;
never allow unauthenticated access. The Dockerfile installs ffprobe.

## Identity and credits

Requested API alias, actual model and account selector are distinct. Accepted
native models are `gemini-3.8-flash` / `gemini-3.8-flash-n` under selector
`gemini-3.8-flash-medium`; accepting both is not a parity claim.

Native LOW was observed to omit `consumedCredits`. The receipt represents that
as `paid_credit_status=not_reported`, `consumed_credits=null`, never as verified
zero. Explicit numeric zero is `reported_zero`; any nonzero or invalid value is
rejected. Allowance-only transport requires the existing account tier, fresh
quota and disabled G1 paid-credit settings. Subscription success costs **zero
Makaron credits**, with ordinary usage attribution. That does not prove Google
paid-credit consumption was zero or remove subscription/Cloud costs.

API billing counts prompt + tool prompt as input and candidates + thoughts as
output, splitting cached input once. All helper ledger writes are awaited. No
flat one-credit charge was introduced. At live rates of $0.75 input / $3.75
output per million, 2× markup and $0.01 per credit, the observed 712 input +107
output costs $0.00093525 before markup, or 0.18705 credits, rounded up to **1**.
10,000 input +1,000 output rounds to **3**, not one.

## Verification and rollout

Run targeted Vitest coverage from App CI, then Python tests:

```sh
python -m pip install -r services/google-subscription-extension/requirements.txt
python -m unittest discover -s services/google-subscription-extension -p 'test_*.py'
```

The opt-in smoke script calls published hero videos only and writes private local
results, without touching product balances. Real comparisons must identify
`provider=gemini-subscription`; an API fallback is not a Relay result. Short
first-party smoke does not establish long-video/OCR/dialogue quality, latency
percentiles or production acceptance. Keep the flag off until those gates,
real chat/MCP/admin ledger checks, role revocation and rollback checks pass.
Publish and CLI parity follow the normal release checklist after authorization.
