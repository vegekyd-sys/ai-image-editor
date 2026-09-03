# Video submission intent regression (2026-09-03)

## Contract

- `generate_animation.video_intent` defaults to `generate`: new video, photo
  animation, lookbooks, loose references, ordinary source edits and extensions.
  A stray `replication_contract` does not change the prompt, references, model,
  resolution, or price in this mode.
- Only explicit `replicate` enables the existing measured replication compiler.
  It requires a contract, a ready project video at the source Media Index, and
  a model with video-reference support. Do not infer replication from identity
  preservation or merely from the existence of an optional object.
- Azure/Codex Responses tools explicitly send `strict:false` unless a tool
  already selects strict mode. Local Zod validation remains mandatory. This
  preserves optional fields instead of relying on upstream schema normalization.
- Repeated local script/capability validation failures get one correction
  opportunity, then a terminal result through the existing Agent stop contract.
  Feedback includes referenced indices and actual replication state. No provider
  retries, model fallback, or source-image substitution are introduced.
- Price reservation, provider submission, snapshot persistence and refunds retain
  their existing shared path. No database migration or live balance edits.

## Evidence

The reported lookbook request referenced only `media_2`, but contained a fabricated
replication contract referencing `media_1`. Prompt compilation added a second
reference, and H3 Max's local single-image validation rejected all four attempts.

Regression tests execute the real Agent tool factory and real provider adapter
with isolated external effects: the old all-fields input now submits once, sends
the selected generated image, reserves 120 credits once for 15s/768p, and inserts
one video snapshot. Valid source-led replication still defaults to Prime/720p;
invalid or incompatible replication fails before billing.

On 2026-09-03, the opt-in live test used the real Codex Terra Agent and real fal
H3 Max adapter: one tool call, no replication contract, selected `media_2`, one
5s/768p submission, completed video verified with ffprobe. Wallet/snapshot writes
were isolated fixtures (40 credits), not production ledger acceptance. Provider
generation is real and may incur its normal charge. Test duration was 19.90s,
including Agent, provider, polling and decode inspection; not inference latency.

Run local regression: `npm test -- __tests__/videoSubmissionIntent.test.ts`.
The `.live.test.ts` is skipped by default. To intentionally run one paid smoke,
load server credentials and set `MAKARON_VIDEO_INTENT_LIVE=1` and
`MAKARON_VIDEO_INTENT_PROJECT_ID` to the authorized two-image test project.
The live test never writes to that project or its wallet.
