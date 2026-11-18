# GPT 6.2 / 6.1 provider acceptance — 2026-11-18

Adds `gpt-6.2-sol`, `gpt-6.2-astra`, and `gpt-6.1-terra` to Makaron's API and personal Codex choices. Existing model IDs, Auto default, subscription eligibility and OpenAI budget-first routing are preserved. CLI source/package metadata is prepared as 0.17.23; it has not been published.

## Runtime results

| Route | Sol 6.2 | Astra 6.2 | Terra 6.1 |
| --- | --- | --- | --- |
| OpenAI API | Pass | Pass | Pass |
| Relay before upgrade, Codex 0.162.0 | HTTP 400 unsupported model | HTTP 400 unsupported model | Pass |
| Isolated relay, Codex 0.169.1 | Pass | Pass | Pass |
| Production HTTPS relay after upgrade | Pass | Pass | Pass |
| Azure API | HTTP 401 | HTTP 401 | HTTP 401 |

A pass means the actual application model adapter completed a streaming, two-step Responses turn, executed one deterministic local function with the expected argument, returned `MODEL_PROBE_OK`, and reported the requested model in both response steps. No media generation, project writes, provider fallback or automatic model-call retries were used. OpenAI's existing supplier usage instrumentation still runs.

- `live.json`: initial 9-path matrix, retaining initial failures.
- `relay-diagnostic.json`: detailed 400 responses from the old relay.
- `relay-candidate-01691-ipv6.json`: successful isolated candidate; the two earlier candidate files retain local IPv4 tunnel connection failures (the listener was on IPv6).
- `relay-production-01691.json`: official HTTPS relay after upgrade; all three exact model IDs verified.
- `relay-production-legacy.json`: GPT-6 Luna and GPT-6.1 Sol both still pass after upgrade.
- `azure-diagnostic.json`: actual Responses calls failed with 401 before inference. The live production `/api/health` also reported Azure HTTP 401; a fresh Vercel production env pull matched the tested local key and endpoint. No credentials were changed. Azure model deployment availability remains unverified.

OpenAI probe usage was 346 input / 26 output tokens each for Sol and Astra, and 326 / 26 for Terra. Before the new rates are applied, the existing OpenAI instrumentation warns and records these probes with zero supplier cost. At the new standard uncached input/output rates, the three probe turns total about $0.005216 (an estimate, not a provider invoice). Production database prices were not changed by this PR work.

## Relay operation

The user explicitly authorized the relay's Codex upgrade. The production service was idle (zero established inbound connections) before the switch. Its Codex package was upgraded from 0.162.0 to pinned 0.169.1 and `makaron-codex-relay.service` restarted at 2026-11-18 09:39:50 CST. Service state, local health, deployed package/lock SHA-256 and public HTTPS streaming/tool calls were checked. No model defaults or allowlists were changed.

The old package manifests and `node_modules` are retained on V under `/srv/vlab/makaron-codex-relay/rollback-codex-01620-20261118`. To roll back, stop the relay, preserve the current manifests/modules in a separate rollback directory, restore the old manifests/modules, and start the service; then re-run legacy smoke checks. This restores the old relay but loses Sol/Astra 6.2 support. The temporary candidate process and SSH forwarding were stopped after verification.

## Application validation and rollout

- 100 focused tests: model identity, authorization, budget/fallback, reasoning parameters, SDK Responses selection, relay transport and selector interactions.
- TypeScript and UI i18n checks.
- CLI smoke/upload tests, including all six new API/subscription preference values.
- Skill sync and four live routing-only cases, stopped before media operations; evidence refreshed after rebasing onto current dev.
- `migration-check.json`: PostgreSQL via isolated PGlite; applied the six-price upsert twice, verified exact prices/idempotency and preservation of an existing control row. No shared DB writes for migration validation.
- Chrome on `http://localhost:3048/home`: all three names/descriptions rendered; selecting Astra changed the visible model chip and radio state. No console warnings/errors or framework overlay. The in-app browser was attempted first but returned `Browser is not available: iab`. Logged-in subscription UI and mobile layout were not browser-tested; selector component tests cover the subscription choices.

Before application rollout, apply `20261118090000_gpt62_agent_rates.sql`, resolve the existing Azure credential/endpoint issue and re-run its real inference checks. The migration uses official Standard USD/1M prices and 30-minute cache-write prices. Existing pricing limitations for other service tiers or long-context multipliers are unchanged. The app, pricing migration and CLI/npm have not been released by this task; only the explicitly authorized relay runtime upgrade is live.

Re-run without exposing credentials:

```sh
pnpm exec tsx scripts/smoke-gpt62-providers.ts /path/to/private.env /tmp/gpt62-live.json
# Optional: PROBE_PROVIDER=openai|azure-openai|codex-subscription
# PROBE_MODEL limits one model; PROBE_LEGACY_ONLY=1 checks Luna 6 / Sol 6.1.
# PROBE_RELAY_URL selects an isolated relay endpoint.
```

Official contracts: [Sol 6.2](https://developers.openai.com/api/docs/models/gpt-6.2-sol), [Astra 6.2](https://developers.openai.com/api/docs/models/gpt-6.2-astra), [Terra 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Azure Responses](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses). New models use Responses for tool calling, including the configured OpenRouter fallback. That fallback is contract-tested, not live-tested here.
