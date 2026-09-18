# CLI per-run billing (2026-09-19)

Branch: `claude/makaron-cli-billing-tracking-9e7791` (based on `dev`). Status: implemented and
tested locally, **not merged, migration not applied, CLI 0.15.0 not published**.

## What the user sees

```
$ makaron chat --project auto --image photo.jpg "make it cinematic"
🚀 Run started: 4f1c…
…
━━━ Results ━━━
🖼️  Image: https://…
🔗  https://www.makaron.app/projects/…
💳  43 credits used (agent 24 · generate_image 19) · balance 1157
```

- `chat --json` → the run JSON carries `usage` (`credits_charged`, `credits_refunded`, `credits_net`,
  tokens, per-tool `entries`, `balance`).
- `chat -b` → later `responses get <runId> --pick credits_used` / `--pick usage`.
- `responses watch --jsonl` → the `done` event carries `usage`.
- `chat --stream` (legacy SSE) → the CLI fetches `?usage=true` after the stream ends.
- `makaron usage [--run <id>] [--project <id>] [--limit n] [--json]` → usage rows and, when
  filtered, a summary total.
- Direct MCP commands (`edit`, `video`, `music`, `analyze`) print `💳  N credits used · balance M`
  from the `X-Credits-Charged` / `X-Credits-Remaining` headers.

## How attribution works

1. `usage_logs` gains `run_id` and `project_id` (migration
   `supabase/migrations/20260919000000_usage_logs_run_attribution.sql`). `deduct_and_log` and
   `refund_credits_and_log` take `p_run_id` / `p_project_id` (default NULL). The old signatures are
   dropped first so PostgREST never sees two overloads. A refund that does not know its run inherits
   the attribution of the reservation it offsets, so async video-failure refunds
   (`fail_video_snapshot_and_refund`) stay attributed.
2. `src/lib/billing/attribution.ts` keeps a `BillingAttribution` (`runId`, `projectId`, `source`,
   `apiKeyId`) in `AsyncLocalStorage`. `/api/agent`, `/api/agent/run` and the execution runner call
   `enterBillingAttribution` once the run id exists; every `deductByTokens` / `deductCredits` /
   `deductFixedCredits` / `refundCredits` / `recordSubscriptionUsage` inside the run picks it up,
   including fire-and-forget `import('./billing/credits').then(...)` calls. Explicit arguments win.
3. `source` is `app` (browser session), `cli` (request carries `X-Makaron-Client: makaron-cli/<v>`),
   `api` (bare API key) or `mcp`. The run stores it in `agent_runs.metadata.billing` so durable
   attempts on other workers inherit it.
4. `/api/agent/run/[id]` adds `usage` once the agent has stopped (`agent_status` present) or when
   `?usage=true`. Agent token charges are awaited before the run turns terminal, so the CLI's terminal
   poll already sees them. `/api/billing/usage` accepts API keys and `run_id` / `project_id` filters.

## Safety without the migration

If the migration is not applied yet, `deduct_and_log` / `refund_credits_and_log` are retried with the
previous signature (PGRST202), subscription usage inserts drop the two columns, run usage lookups
return an empty summary with a console warning, and the CLI simply prints no credit line. No charge is
lost. `/api/billing/usage` returns 501 for run/project filters in that state.

## Rollout order

1. Apply the migration to the shared Supabase project (prod and preview share it).
2. Deploy the app (`dev` → preview smoke → `main`).
3. `npm publish` makaron-cli 0.15.0 from `packages/makaron-cli` (needs the deployed
   `/api/billing/usage` and `usage` field).

## Verification performed

- `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (287 files / 1766 tests), CLI smoke
  (`npm --prefix packages/makaron-cli test`), `npm run check:agent-discovery`,
  `npm run lint:agent-docs`.
- Migration applied to a scratch `postgres:16` container with the legacy 11-arg / 4-arg functions
  pre-created: the old overloads are dropped, both the new 13-arg call and the legacy positional call
  resolve, a refund without run id inherits `run_id` / `project_id` from the reservation, and the
  per-run sum is correct.
- Not yet verified: a real `makaron chat` against a deployment with the migration applied.

## Known gaps

- Direct `/api/video-snapshot` and `/api/animate` calls (CLI `video create --project`) are not agent
  runs, so their rows have no `run_id`; the CLI does not print their cost yet.
- `rotate_camera` and Seed Audio tool charges are still fire-and-forget inside the run; they are
  attributed, but a poll that lands within milliseconds of the terminal status may miss them.
