# Grok personal-plan relay

Status: isolated worktree and VLab experiment. Not merged or deployed to production.

## Goal

For explicitly allowlisted Makaron users, run Grok 4.6 Agent chat plus Grok
Imagine video generation, edit, and extension through the owner's xAI
credential on VLab. Keep every other model and every non-allowlisted user on
the existing provider paths.

## Boundary

- Vercel stores only the relay URL, HMAC secret, owner user ID, and optional
  allowlist. It never stores the xAI credential.
- VLab stores the xAI Device OAuth profile in an owner-only `0600` state file
  and runs a dedicated `makaron-grok` service. It does not share the Codex
  relay process, Unix user, state directory, or port.
- The relay implements xAI discovery, device-code polling, access-token expiry,
  and refresh-token rotation directly. OpenClaw was used only as a readable
  reference for xAI's public OAuth parameters; it is not installed or executed
  by this service.
- The relay exposes only health, preflight, Grok 4.6 streaming chat, plan usage, video
  submit/edit/extend, and video status paths. Agent chat is forwarded to xAI's
  official Grok Build headless endpoint with the official client headers; video
  continues to use the xAI video endpoint. Requests are allowlisted,
  timestamped, HMAC signed, and replay protected.
- Subscription tasks use `xai-sub-<request_id>`; direct API tasks retain
  `xai-<request_id>`.

## Safe fallback contract

The direct xAI API fallback is allowed only when the relay preflight fails, or
when xAI synchronously rejects the relay request with 401, 403, or 429 before a
task is created. A network error after the submit request has been sent is an
unknown outcome and fails closed. This prevents duplicate paid video tasks.

Makaron credits are reserved only immediately before a safe direct-API
fallback. A successful personal-plan task records zero Makaron credits and no
estimated API provider cost.

Agent fallback follows the same fail-closed principle at the Makaron execution
boundary: `grok-subscription` may change to the existing OpenRouter Grok 4.6 API
route only before any visible text, delivered artifact, or committed tool call.
The base `grok-4.6` preference remains OpenRouter API;
`grok-4.6-grok-subscription` is the explicit personal-plan preference. Auto and
the default Terra route are unchanged.

## Live acceptance

1. Run `node authorize-xai-oauth.mjs` as `makaron-grok`, open the printed xAI
   verification URL, and enter the one-time code. Only the URL/code are printed;
   access and refresh tokens are written directly to the isolated state file.
2. Submit one minimum-duration 480p Imagine video for the owner user.
3. Require a returned `xai-sub-` task ID and poll it through the relay.
4. Download and decode-check the resulting video.
5. Confirm the corresponding Imagine/API usage in the account's Grok Usage
   settings before calling the subscription claim verified.

### 2026-09-01 result

- A signed direct-relay request completed as
  `xai-sub-29ce80d5-2bd1-9a07-8105-9cbd40dcad8d`. The downloaded MP4 decoded
  cleanly as H.264 848x480 with AAC audio.
- A real `makaron video create --video-model grok` run completed as
  `xai-sub-a6b57063-3f68-9dcb-a4b2-8acc7e3054ad` while every local xAI API-key
  environment variable was explicitly unset. Before that CLI user was added to
  the relay allowlist, the same route failed closed with `XAI_API_KEY not
  configured`, proving there was no hidden key fallback.
- After a fresh Console refresh, neither OAuth request ID appeared in the xAI
  Console Video API log. The SuperGrok Usage screen showed 1% of the shared
  weekly allowance used under Grok Build and US$0.00 Extra Usage Credits.
  Because the subscription UI rounds to whole percentages, this establishes
  the route and billing bucket, not an exact per-video allowance delta.
- The signed Agent relay returned HTTP 200 from upstream model
  `grok-4.5-build` with the exact smoke-test response. A second end-to-end test
  used Makaron's real AI SDK runtime and resolved `{ provider:
  "grok-subscription", model: "grok-4.5", providerModelId: "grok-4.5" }`
  before receiving the exact streamed response. No xAI API key was supplied.
- After merging the Grok 4.6 catalog, a real local `makaron chat` run explicitly
  selected `grok-4.6-grok-subscription`, completed with the exact response
  `GROK_46_SUBSCRIPTION_OK`, and logged `model=grok-4.6 provider=grok-subscription`.
  The signed billing check returned the independent xAI weekly window with 98%
  remaining; Codex usage remained a separate provider-scoped value.

## Production limitation

This owner-only experiment currently uses the public xAI device-OAuth client
parameters used by an approved third-party integration. Do not expose it as a
general Makaron OAuth product or onboard arbitrary end users. Before a broader
production rollout, Makaron needs an xAI-approved OAuth client and explicit
confirmation that the intended commercial workload is permitted. Until then,
keep the relay restricted to the owner's credential and Makaron user allowlist.
