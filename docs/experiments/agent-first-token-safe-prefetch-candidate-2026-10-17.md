# Agent first-token safe-prefetch candidate — 2026-10-17

## Status

Local candidate only. This branch is not pushed, merged, deployed, or production-accepted.

- Branch: `codex/agent-ttft-safe-prefetch`
- Worktree: `/Users/tianyicai/.codex/worktrees/agent-ttft-safe-prefetch/ai-image-editor`
- Base: `b59cdeeee2805b0169900b6c6fbb3275066b7ce1`
- Scope: prompt-prefix stability, read-only prompt prefetch, and read-only route-gate parallelization

The historical commits `f06c8707` and `75e0d182` were inspected as evidence only. Neither was cherry-picked.

## Candidate changes

### Stable system-prompt prefix

`buildSystemPrompt` keeps the base prompt, workspace instructions, manifest, and user memory ahead of all project-specific bytes. The project id, project path, and project memory are appended in a final `## Current project` block. The prompt log now records `cacheablePrefix` length.

No tool description, model capability, workspace capability, Skill manifest, or memory content was removed.

### Read-only prompt prefetch

Manifest, user memory, and project memory reads now start together. `prefetchAgentPrompt` starts core-prompt-mode and system-prompt loading before `buildPromptContext`; the durable runner passes that handle to `runMakaronAgent`.

Both prefetched promises have rejection guards. The agent catches either failure and performs the original inline read/build, so prefetch is an optimization rather than a new availability dependency.

### Side-effect-safe route gates

After structural/model-shape validation, the route starts these independent read-only operations together:

- Codex subscription allowlist lookup
- Skill launch verification
- project timeline lookup
- active Agent Run lookup

Invalid Skill launches and legacy-run conflicts return before `requireCredits`. Credit validation still completes before either appending input or inserting a new Agent Run. The existing allowlist, model resolution, credit rejection, append, and durable-run behaviors remain in force.

## Preserved contracts

- full `createTools` surface and existing model/provider resolution
- Skill launch verification and Codex subscription allowlist
- billing precheck and usage recording
- durable Agent Run with `inline-first-attempt`
- SSE streaming, event-log reconnect, heartbeat, lease, recovery, and continuation
- existing prompt-context and provider-compaction behavior

## Local verification

| Check | Result |
|---|---|
| New safe-prefetch + existing Fast Lane + admission tests | 13/13 passed |
| `tsc --noEmit` | passed |
| Full `npm run lint` pipeline | passed with 8 pre-existing warnings, 0 errors |
| Agent startup contract | passed |
| Full `npm test` | 2,473 passed, 1 skipped, 1 unrelated baseline failure |
| `git diff --check` | passed |

The full-suite failure is `__tests__/agentDiscovery.test.ts`: the base commit's test expects five positive discovery evals while the base commit's `packages/makaron-cli/evals/agent-discovery.json` contains eight. Neither file is changed by this candidate.

## Explicitly not validated

- no current fixed-sample six-round TTFT comparison
- no current P50/P75 or provider cache-read measurement
- no real model, image, video, music, or other paid API call
- no media-quality or final-artifact non-inferiority gate
- no browser, Preview, or Production acceptance

Therefore this candidate does not claim a measured latency win, unchanged media quality, or release readiness. Those remain later acceptance gates against the same fixed prompts, provider/model, route strata, and retained failure samples.
