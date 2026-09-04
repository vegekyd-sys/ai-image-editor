# Wan / H3 / conversation-language repair acceptance

2026-09-04, branch `codex/wan-h3-language-fixes`, based on dev `5cf82637`.

**Release decision (2026-09-04):** after reviewing the [DeepSeek CLI/browser report](deepseek-language-qa-2026-09-04.md), the user explicitly requested merging the simplified implementation into dev and releasing it. Known language-switch failures remain; this is not an all-cases behavior acceptance. The earlier 8/8 result below belongs to the earlier implementation, not this simplified version. Deployment evidence is recorded separately after release.

## Changes

- Validate actual image bytes before Wan submission and before H3 credit reservation. Wan checks every input (240–8000px per side, aspect 1:8–8:1, supported format/opaque PNG, 20MB). H3 checks the 256px minimum. No automatic upscaling, cropping, paid retries, or provider fallback.
- Bounded HTTPS image inspection pins public DNS to the connection, rejects redirects and embedded credentials, and never sends provider credentials. The fixed Makaron CDN also supports local fake-IP VPN routing; arbitrary private destinations remain blocked.
- Wan errors become durable, sanitized tool results. They explain input repair and forbid silently bypassing a required edit with the original photo in a dependent video.
- Fal queue `COMPLETED` + result HTTP 422 becomes `failed`, entering the existing atomic `fail_video_snapshot_and_refund` lifecycle. Result 401/403/404/429/5xx remain polling errors, not terminal failures/refunds. Submit-time 422 is an explicit rejection, not an unknown paid outcome.
- Agent, direct animate API and shared/MCP video paths reserve H3 credits after preflight. Actual resolved duration drives the deferred quote.
- Conversation language now has one short system principle, with normal role-preserving chat history. The extra user-history excerpt and duplicate instructions in the core prompt/image-analysis output have been removed. The neutral user-request wrapper remains. No keyword language router, additional model request, or conversation-language state was introduced. Automatic non-chat reactions still use UI locale.

## Verification

- Full Vitest: **1657 passed, 1 skipped** (271 passing files, one skipped).
- TypeScript `--noEmit --incremental false`: passed.
- Lint/i18n/startup/video-reference gates: passed; one pre-existing unused `locale` warning.
- Production source image read-only probe: both backends reject the actual **384×215** source with actionable dimensions in approximately **1.13s**. No generation request sent.
- Historical result for `491ddcd9`: real GPT-5.6 Terra via the Makaron Agent, tools disabled, no persistence client: **8/8 language cases passed** after adding history evidence. This does not establish acceptance of the simplified follow-up.
- Simplification diagnostics: short-policy variants still failed English + 好 and Chinese request for an English title + ok; substantive English switches were also inconsistent. The same acknowledgement/artifact failures reproduced in bare `generateText` calls with only a short policy and ordinary chat history, without Makaron tools or workspace prompts. A literal system-instruction control returned `POLICY_OK`, so this is not evidence that all system instructions are being dropped. No runtime/provider changes were made on that assumption.
- Final simplified Terra candidate live run: **6/9 passed**, with a failing assertion. Failed cases: English + 好; substantive English switch from Chinese conversation; Chinese request for an English artifact followed by ok. Passed: Chinese + ok (including a repeated turn), Chinese + emoji, substantive Chinese switch, English tool-result isolation, and explicit English preference persistence. The later DeepSeek CLI run passed **15/16**, and browser image-only reply languages passed **5/5**; successful image analysis was blocked locally by the Google API location restriction. Do not represent this as all-cases behavior acceptance.
- Mocked integration: actual App tool → shared createVideo → adapter validates before any debit; submit rejection reserves/refunds once; queued terminal rejection → snapshot route → atomic RPC; refresh skips repeat provider/refund; transaction failure remains retryable; transient provider failure does not refund.
- Live language script: `npx tsx --env-file=/Users/tianyicai/ai-image-editor/.env.local --require ./md-loader.cjs scripts/smoke-agent-language.ts`. This is opt-in and makes text-only model calls; standard tests never use live credentials.

## Boundaries

No production task state, balance, schema, deployment, or alias was changed. Existing failed tasks have not been manually repaired/refunded. No new media was generated. Database transaction semantics use the existing checked-in row-locking/idempotent RPC; tests mock the DB rather than executing a production refund.

Full Next build was not run: the fixed runner had an unrelated uncommitted `src/lib/agent.ts` change. It was preserved. Do not call this a deployed or production-accepted release.

Provider reference: [Alibaba Wan image API](https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-and-editing-api-reference). H3 minimum confirmed by the observed Fal `image_too_small` result (256×256 minimum).
