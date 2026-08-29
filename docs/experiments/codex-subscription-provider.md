# Personal Codex subscription provider experiment

## Goal

Let the Makaron owner run the existing GPT-5.6 Agent through their personal
ChatGPT/Codex subscription first, then use the existing Azure OpenAI or
OpenRouter API path when subscription authentication, quota, or availability is
exhausted. This experiment does not add a new Agent architecture, UI, queue,
database table, or tool protocol.

The product's model ids, system prompt, tool loop, durable runner, frontend
selector, and Makaron Credits accounting remain unchanged. "Subscription first"
only changes the provider selected behind the existing `LanguageModel` seam.

## Boundary

- Owner-only: `CODEX_SUBSCRIPTION_OWNER_USER_ID` must exactly match the current
  Supabase Auth user id. Every other user always stays on the configured API
  fallback.
- Private durable credential runtime only: Codex is installed and logged in on
  the owner's Mac or an isolated persistent host. A Vercel deployment may call
  the owner-only HTTPS relay, but never receives the Codex OAuth token itself.
- No browser BYOK form and no OAuth token in Supabase, Vercel, or Makaron env.
  The private relay asks its local Codex App Server for a short-lived managed
  credential; Codex remains responsible for login persistence and token refresh.
- Fallback is allowed only before visible model output or a committed tool side
  effect. Durable attempts persist this safety state and treat an interrupted or
  unknown state as blocked. This prevents one user turn from executing an
  expensive tool twice.
- Encrypted Responses compaction is provider-bound. Azure state is never replayed
  to the personal subscription transport, OpenRouter, or vice versa.

## Why this is an experiment

OpenAI documents Codex App Server as the supported integration surface for rich
clients and recommends the Codex SDK for server-side control. The App Server
owns ChatGPT login and refresh state. This thin adapter intentionally keeps
Makaron's current AI SDK `LanguageModel` and tool loop by using the same Codex
Responses transport as the installed Codex client. That transport is not a
stable public API contract, so pin and smoke-test Codex upgrades before relying
on it.

Official references:

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)

If this internal transport becomes incompatible, keep API fallback enabled. A
future production-grade version should move the entire Agent turn behind App
Server/SDK instead of expanding this adapter.

## Local setup

1. Install/update Codex on the private runtime and authenticate interactively:

   ```bash
   codex login
   codex login status
   ```

2. Configure Makaron on that same runtime:

   ```dotenv
   GPT56_AGENT_PROVIDER=codex-subscription
   CODEX_SUBSCRIPTION_OWNER_USER_ID=<owner Supabase Auth user UUID>
   CODEX_SUBSCRIPTION_FALLBACK_PROVIDER=azure-openai
   ```

   Optional controls:

   ```dotenv
   CODEX_CLI_PATH=/Applications/ChatGPT.app/Contents/Resources/codex
   CODEX_SUBSCRIPTION_REASONING_EFFORT=medium
   CODEX_SUBSCRIPTION_ORIGINATOR=makaron
   CODEX_SUBSCRIPTION_SMOKE_MODEL=gpt-5.6-terra
   ```

3. Keep the selected fallback's existing API credentials configured:

   - `azure-openai`: the existing Azure OpenAI endpoint/key/deployment env.
   - `openrouter`: `OPENROUTER_API_KEY`.

4. Run the isolated authentication/stream/tool-call/full-Agent smoke:

   ```bash
   npm run smoke:codex-subscription
   ```

The smoke prints only provider/model/result/latency/usage, a deterministic tool
call, and a no-side-effect pass through Makaron's production Agent prompt/tool
schema. It does not print the ChatGPT account id or access credential.

## VLab relay + Vercel Preview

The relay in `services/codex-subscription-relay` is a separate Node service. It
must use its own Unix user, `CODEX_HOME`, pinned Codex CLI, loopback port, and
service unit. Copy only the already-authorized `auth.json` into that dedicated
home; do not share another Agent's sessions, config, workspace, or App Server.

Configure the relay with a root-owned environment file:

```dotenv
CODEX_SUBSCRIPTION_OWNER_USER_ID=<owner Supabase Auth user UUID>
CODEX_SUBSCRIPTION_RELAY_SECRET=<random HMAC secret>
```

Expose only the relay HTTP port through TLS. The public surface accepts
`POST /v1/responses` and `POST /v1/usage`; both require a timestamped HMAC,
the exact owner UUID, and a unique request id. Replayed, stale, tampered, or
non-owner requests are rejected before Codex is touched. `/healthz` contains no
account or usage data.

Vercel Preview keeps the normal default provider unchanged and receives only:

```dotenv
GPT56_AGENT_PROVIDER=azure-openai
CODEX_SUBSCRIPTION_OWNER_USER_ID=<owner Supabase Auth user UUID>
CODEX_SUBSCRIPTION_FALLBACK_PROVIDER=azure-openai
CODEX_SUBSCRIPTION_RELAY_URL=https://<relay-host>/
CODEX_SUBSCRIPTION_RELAY_SECRET=<same random HMAC secret>
```

The temporary Cloudflare quick tunnel used for Preview can change after a
restart. Before Production, replace it with a dedicated named tunnel and stable
hostname, then repeat the same owner, quota, streaming, and API fallback gates.

## Runtime behavior

1. A GPT-5.6 request for the configured owner selects `codex-subscription`.
2. Local mode starts `codex app-server --stdio` directly. Relay mode signs the
   request to VLab; only the isolated relay starts App Server and caches the
   short-lived credential until shortly before expiry.
3. An HTTP 401 asks App Server for one managed refresh and retries once.
4. Health checks read both the managed login and App Server rate-limit state.
   If subscription is unavailable but the configured API fallback is healthy,
   overall health is degraded rather than down.
5. Authentication/entitlement/quota failures switch to the configured API
   provider immediately at the Agent retry boundary. Transient provider errors
   use the existing retry budget first.
6. Non-owner requests never touch the personal subscription and use API directly.

The transport remains owner-only and experimental. It must not be enabled for a
shared user population without per-user OAuth isolation, encrypted credential
storage, revocation, quota ownership, and an explicit provider consent flow.
