# GPT-6.1 Sol

The visible Sol choice is `gpt-6.1-sol`. Base IDs select Azure Responses;
`gpt-6.1-sol-codex-subscription` explicitly selects the authorized personal plan relay.
Old Sol 6 UI preferences upgrade to 6.1 without changing the chosen provider;
explicit legacy IDs remain supported by the API and CLI. Auto remains Luna.
Both routes use native vision and default High reasoning. None/minimal overrides
are unsupported for 6.1 and resolve to High. No new SDK is required.

The isolated relay pins Codex CLI 0.162.0. The previous 0.156.1 client received a
model-not-supported error for 6.1; after the pinned upgrade, a real relay request
recognized an image, called a function, and streamed its final text as 6.1.
The existing Azure resource passed the same check with the exact 6.1 model ID.
Credentials, owner identity, and allowlist are unchanged.

Rates per million tokens: $2 input, $10 output, $0.10 cached input; automatic
caching has no write premium. When upstream reports cold input as cache-write
tokens, that slice costs the ordinary $2 input rate. Product API markup remains 2x.
Subscription Agent usage is recorded with zero credits; media tools retain their
normal prices. The two exact provider billing IDs are registered by the accompanying
migration. [Official model](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Release evidence and the identical 60-second explainer comparison are saved under
`/Users/tianyicai/.codex/visualizations/2026/10/09/01a12079-4757-7be3-9012-adc65b795958/`.
Production deployed `ab979f44` on 2026-10-10 (Asia/Shanghai); the subsequent
price-only correction `e41d5b21` is applied to the shared billing table. Both
production selector routes are visible. Real Azure CLI requests completed,
including a billing-formula check, and the upgraded relay passed the image,
function-call, and streaming probe. All 12 release health checks passed.

NPM `makaron-cli@0.16.2` is published. A fresh registry installation matched the
published tarball SHA-1 and the source CLI, README, bundled Skill, and plugin
metadata. The release passed TypeScript, production builds, CLI smoke, discovery
checks, and 2,335 tests (one skipped). Evidence is in `gpt61-release/` beneath
the directory above; `explainer/` records the separate creative comparison.
