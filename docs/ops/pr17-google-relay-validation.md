# PR17 candidate validation — 2026-11-03

This records an independent candidate, not a production rollout. The application
flag remains off in production. The original Scene V/Cloud service was not
replaced. Its deployed source fingerprints reviewed for the adapter were:

- `server.py`: `dc324815679cb65d671b3ac816e38881c05fee315cd62d0786479812d361baf4`
- `native_video.py`: `37a4b35f5eafc245af0abef33d4bd7f4f65efb7ce638c624315afa2e5ef375af`

## Real requests

The candidate used the existing subscription account through a separate V port,
state journal and private Cloud Run sibling. Short-lived Cloud IAM identity was
minted by the operator. **The deployed Vercel OIDC federation has not been tested
or enabled.** Application authorization still called the real candidate endpoint
and checked live personal-plan membership plus administrator role at admission
and execution. No private user media was submitted.

| Check | Direct evidence |
| --- | --- |
| Published floral / android / cloud-house videos | Each obtained a complete native `gemini-3.8-flash-n` subscription result. The same original public sources were also analyzed by API `gemini-3.8-flash`. |
| Silent video | All successful comparison outputs acknowledged no sound after deterministic container audio-track metadata was added. |
| Published cloud-house still | Native subscription helper completed; actual usage ledger: 1,114 input / 60 output tokens, **0 Makaron credits**. |
| MCP API call | Real existing API key: 737 input /146 output, **1 credit** in both the HTTP header and ledger, source `cli`. |
| MCP subscription call | Real listed administrator API key: 738 input /165 output, **0 credits** in both header and ledger; one `:gemini-subscription` row, source `cli`. |
| Paid-credit telemetry | Native response omitted `consumedCredits`. The verified result and route audit preserve `not_reported` / `null`; zero Makaron credits does not prove zero Google paid credits. |

Observed android and cloud-house subscription latencies were approximately
14.4s /13.5s, versus API 8.5s /9.3s. These are individual operator-Mac samples,
not p50/p95, and do **not** establish a speed improvement. Fine OCR details also
differed between outputs; no broad factual-quality parity is claimed.

The first cold preflight exceeded its 2s bound and safely used the API before
job admission. Initial Cloud receipt writes were rejected because a candidate
prefix was outside the service account's existing conditional authorization.
Those jobs remained unknown without automatic inference replay/API fallback.
The candidate prefix was moved under the already authorized object prefix;
shared bucket IAM was not expanded. Initial failures remain in private evidence.

## Automated and UI checks

Targeted regression covers billing rounding, cache and thoughts, real MCP HTTP
transport debit headers, native-vision preservation, disabled and ordinary-user
behavior, roster rollback, fresh job-bound authorization, quota/capability gates,
strict receipts and unknown outcomes. Python service tests exercise durable
admission, duplicate/conflicting IDs, restart recovery, owner/member boundaries,
role revocation before execution, fixed sources and paid-credit telemetry.

The actual administrator React page was displayed in the in-app browser using
fictional accounts and a local fixture control API. Google changed from pending
to synchronized after clicking Sync. Four locales are covered by component tests.
This UI fixture is not evidence that production Google membership was modified.

Before production activation: accept Vercel federation and exact IAM audience,
shared-service deployment review, long input/OCR/dialogue quality, concurrency and
cold/warm latency, real application chat, quota exhaustion/recovery and rollback.
Keep the release flag off until those gates pass. API fallback remains normally
billed; image generation, Tips, embeddings and CLI/npm releases are unchanged.

## Latency follow-up

The same public cloud-house MP4 and user question were run in three alternating
subscription/API pairs before and after the transport changes. These are small
operator-Mac samples, not production percentiles or deterministic model outputs.

| Route | Before, seconds | After, seconds | Before / after median |
| --- | --- | --- | --- |
| Subscription | 13.760, 12.781, 10.498 | 11.509, 9.824, 12.230 | 12.781s / 11.509s |
| API | 10.775, 8.522, 9.601 | 8.330, 7.155, 10.046 | 9.601s / 8.330s |

Cloud step measurements found a 2,113ms first-run ffprobe invocation and
129–131ms warm probes. The bounded MP4/MOV atom reader reduced that step to
2–4ms in the candidate. It validates the complete movie and every track handler;
unknown/malformed containers use ffprobe. No video bytes are changed. Its movie
header duration now follows the API path (the three fixtures differ from
ffprobe's stream duration by only 0.333ms); audio-track presence agrees with
ffprobe for all three fixtures.

The Cloud stream now emits the durable terminal receipt as soon as its worker
finishes, keeping a 5s heartbeat for ongoing work. The V receipt endpoint supports
a bounded completion wait; the application skips its old 500ms sleep only when
the server confirms support. Older servers retain the original polling behavior.
Unknown outcomes still poll the same job and never resubmit. Authorization is
still fresh at admission and execution; no caller role or quota is cached.

The application also reuses a valid audience/account-bound Cloud IAM identity
for at most five minutes, refreshing at least 60s before JWT expiry. This avoids
repeating STS/IAM exchanges on warm requests. The live benchmark used an
operator IAM token, so it **does not measure the Vercel identity-cache benefit**.

Native generation still took about 7–9s in the optimized samples. Output lengths
and upstream load varied; the roughly 1.3s median reduction alone does not prove
a stable 10% improvement. The same-round API remained faster. These changes do
not justify enabling production or claiming subscription/API speed parity.
