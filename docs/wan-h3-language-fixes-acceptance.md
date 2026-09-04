# Wan / H3 / conversation-language repair acceptance

2026-09-04, branch `codex/wan-h3-language-fixes`, based on dev `5cf82637`.

## Changes

- Validate actual image bytes before Wan submission and before H3 credit reservation. Wan checks every input (240–8000px per side, aspect 1:8–8:1, supported format/opaque PNG, 20MB). H3 checks the 256px minimum. No automatic upscaling, cropping, paid retries, or provider fallback.
- Bounded HTTPS image inspection pins public DNS to the connection, rejects redirects and embedded credentials, and never sends provider credentials. The fixed Makaron CDN also supports local fake-IP VPN routing; arbitrary private destinations remain blocked.
- Wan errors become durable, sanitized tool results. They explain input repair and forbid silently bypassing a required edit with the original photo in a dependent video.
- Fal queue `COMPLETED` + result HTTP 422 becomes `failed`, entering the existing atomic `fail_video_snapshot_and_refund` lifecycle. Result 401/403/404/429/5xx remain polling errors, not terminal failures/refunds. Submit-time 422 is an explicit rejection, not an unknown paid outcome.
- Agent, direct animate API and shared/MCP video paths reserve H3 credits after preflight. Actual resolved duration drives the deferred quote.
- Conversation language follows explicit preference, substantive current request, then preceding substantive user language for approvals. Remove the conflicting current-message-language wrapper. Provide bounded user-only history evidence, excluding assistant artifacts and tool output. No keyword language router or additional model request.

## Verification

- Full Vitest: **1657 passed, 1 skipped** (271 passing files, one skipped).
- TypeScript `--noEmit --incremental false`: passed.
- Lint/i18n/startup/video-reference gates: passed; one pre-existing unused `locale` warning.
- Production source image read-only probe: both backends reject the actual **384×215** source with actionable dimensions in approximately **1.13s**. No generation request sent.
- Real GPT-5.6 Terra via the Makaron Agent, tools disabled, no persistence client: **8/8 language cases passed** after adding history evidence. Chinese + ok; repeated ok next turn; Chinese + emoji; English + 好; meaningful English and Chinese switches; English artifact in Chinese conversation; persistent explicit English preference. Earlier policy-only drafts failed the English + 好 case and were not accepted.
- Mocked integration: actual App tool → shared createVideo → adapter validates before any debit; submit rejection reserves/refunds once; queued terminal rejection → snapshot route → atomic RPC; refresh skips repeat provider/refund; transaction failure remains retryable; transient provider failure does not refund.
- Live language script: `npx tsx --env-file=/Users/tianyicai/ai-image-editor/.env.local --require ./md-loader.cjs scripts/smoke-agent-language.ts`. This is opt-in and makes text-only model calls; standard tests never use live credentials.

## Boundaries

No production task state, balance, schema, deployment, or alias was changed. Existing failed tasks have not been manually repaired/refunded. No new media was generated. Database transaction semantics use the existing checked-in row-locking/idempotent RPC; tests mock the DB rather than executing a production refund.

Full Next build was not run: the fixed runner had an unrelated uncommitted `src/lib/agent.ts` change. It was preserved. Do not call this a deployed or production-accepted release.

Provider reference: [Alibaba Wan image API](https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-and-editing-api-reference). H3 minimum confirmed by the observed Fal `image_too_small` result (256×256 minimum).
