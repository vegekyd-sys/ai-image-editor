# Manifest-only Skill startup: Production TTFT release gate

Date: 2026-08-31 (Asia/Shanghai)

Status: **rejected and rolled back**. The manifest-only change remains merged in `dev`, but Production was restored to the pre-release deployment because Codex P50 and P75 regressed in this 6-round gate.

## Scope

- User prompt: `hello makaron`
- Metric: click on Send to the first non-empty assistant text rendered in `.markdown-body`
- Six attempts per provider, interleaved in the frozen order below
- Every attempt used a newly created empty project and the dedicated E2E account
- Exact model: `gpt-5.6-terra`
- Providers: `azure-openai` and `codex-subscription`
- No hardcoded greeting or Fast Pass
- No reruns; failures remain frozen
- Quality gate: natural generated reply, completed run, zero tool calls, messages from 0 to 2, exact provider/model

Frozen order:

`azure-r1, codex-r1, codex-r2, azure-r2, azure-r3, codex-r3, codex-r4, azure-r4, azure-r5, codex-r5, codex-r6, azure-r6`

## Deployments

- Before / rollback deployment: `dpl_DPQtDcJWvscqmA3kaEoqgxkFcN1L`
- Candidate deployment: `dpl_39uVseAj38NsdUScmPuMdjdSuwn8`
- Candidate commit: `0a6be1e15156294de78daf7173dfc565ed5d947a` (`perf: enforce manifest-only Skill startup`)
- Final Production state: rolled back to `dpl_DPQtDcJWvscqmA3kaEoqgxkFcN1L`
- Post-rollback health: 13 healthy, 0 unhealthy, 0 unavailable

## Results

All durations are milliseconds. Negative deltas are improvements.

| Provider | Stage | Raw six attempts | P50 | P75 | Mean | Max |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Azure API | Before | 8126, 8036, 10037, 9735, 7997, 13584 | 8931 | 9962 | 9586 | 13584 |
| Azure API | After | 9876, 7989, 9744, 8036, 7967, 11546 | 8890 | 9843 | 9193 | 11546 |
| Codex subscription | Before | 7930, 7886, 7989, 9712, 9730, 7894 | 7960 | 9281 | 8524 | 9730 |
| Codex subscription | After | 7896, 9898, 9709, 4391, 9546, 4968 | 8721 | 9668 | 7735 | 9898 |

| Provider | P50 delta | P75 delta | Mean delta | Max delta | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Azure API | -41 ms (-0.5%) | -119 ms (-1.2%) | -393 ms (-4.1%) | -2038 ms (-15.0%) | Slight improvement |
| Codex subscription | +761 ms (+9.6%) | +387 ms (+4.2%) | -789 ms (-9.3%) | +168 ms (+1.7%) | **Rejected: P50/P75 regressed** |

## Evidence qualification

- Before: Azure 6/6 and Codex 6/6 had complete evidence; no failures; cleanup remaining 0.
- After: Codex 6/6 and Azure 5/6 had complete evidence; cleanup remaining 0.
- Azure after r6 rendered its first DOM text at 11546 ms and is retained in the six-point distribution. A later Supabase evidence read hit a 10-second network connect timeout, so that attempt is marked evidence-incomplete and was not rerun.
- All fully validated attempts used the exact requested provider/model, completed normally, produced natural greeting text, and made zero tool calls. No observed response-quality regression.
- The candidate therefore passed functional/quality checks but failed the speed-only acceptance rule.

## Raw evidence hashes

- Before JSON: `/tmp/makaron-production-before-manifest-only.json`, SHA-256 `9ba878da6c4f539101270e86a1bbcf6603f6e58adaaa9d45271c36b6fd83aa09`
- After JSON: `/tmp/makaron-production-after-manifest-only.json`, SHA-256 `fdf88f1c9a155e8ecd8870578ec6f2003a19c78d8dd609ada28a3174173e5215`

## 2026-10-17 read-only closeout audit

This section reconciles the abandoned August phases and later September work
against the current repository and Production entry point. No model request,
benchmark rerun, deployment, environment change, database write, or old patch
application was performed for this audit.

Observed current state:

- `dev` and `origin/dev` are both `b59cdeeee2805b0169900b6c6fbb3275066b7ce1`.
- Production alias `https://www.makaron.app` currently resolves to deployment
  `dpl_4AF7Tyq7dkgn97SDqgji5dqPMkVW`, created 2026-10-14, and `/api/health`
  reported 12 healthy / 0 unhealthy / 0 unavailable; Azure OpenAI and Codex
  subscription health were both green.
- Vercel inspection did not expose a source commit for that deployment. The
  current Production source SHA and current Production TTFT are therefore not
  asserted from the deployment timestamp alone.
- The only live task matching this work is this `提升 Agent 首字速度` thread.
  No second active TTFT implementation task was found in the current task list.
- The unrelated deletion of `.claude/skills/browser-test/SKILL.md` already
  existed in the shared worktree and was left untouched.

### Difference table

| Item | Current result | Evidence and remaining boundary |
| --- | --- | --- |
| August manifest-only Skill startup (`f06c8707`) | **Covered; close the old gap** | The commit itself is not an ancestor of current `dev`, but its contract has been retained and extended: generated `src/generated/built-in-skill-manifest.json`, `getSkillManifest()`, `agentSkillStartupContract`, `scripts/check-agent-startup-contract.ts`, `check:agent-startup`, and release/Skill-sync gates are present. Built-in Skill bodies are not parsed on the request path. User Skills use metadata sidecars or bounded frontmatter-only legacy backfill, not full-body eager loading. Do not reapply the old patch. |
| Fast Lane + Durable (`4733f015`) | **Implemented in current `dev`; later work supersedes the old phase design** | `4733f015` is an ancestor of current `dev`. The current route still declares `inline-first-attempt`, `transport: sse`, `reconnect: event-log`, starts the first durable attempt in the same request, and retains event-log replay/cron recovery contracts. Historical Production acceptance on 2026-09-01 was 6/6 valid with P50 4.871s and P75 6.508s. That is a historical comparison point, not proof of the 2026-10-17 Production latency. |
| Stable prompt prefix from `75e0d182` | **Still valuable, not implemented** | Current `buildSystemPrompt()` inserts the project-specific `${projectId}/code/` path before the Skill manifest and does not log a stable `cacheablePrefix`; this can truncate cross-project provider prompt-cache reuse. The old commit moved project-scoped text and project memory to a final `Current project` block. |
| Prompt construction prefetch from `75e0d182` | **Still valuable, not implemented** | Current runner builds prompt context first and only builds the system prompt inside `runMakaronAgent`; there is no `prefetchAgentPrompt` / `promptPrefetch`. Current `buildSystemPrompt()` also awaits manifest, user memory, and project memory serially rather than starting the independent reads together. |
| Route-gate parallelization from `75e0d182` | **Partially covered, still incomplete** | Current route already parallelizes auth with body parsing and allowlist with Skill launch verification, and preloads runtime imports. Credit checking still completes before project/admission reads start. A new implementation may overlap safe reads, but must not call side-effecting `requireCredits` for a request that authorization/admission will reject. |
| Fresh current Production performance proof | **Missing** | The latest durable evidence remains the 2026-09-01 Production benchmark. This audit intentionally made no model/API request, so it does not claim that the current October deployment still meets that distribution. |
| Current-dev A/B for the September candidate | **Missing** | `75e0d182` is not an ancestor of `dev`; its measurements were made on its own September worktree. There is no frozen current-dev baseline/candidate 6x6 comparison, no current project-list and project-page paired gate, and no current reconnect/quality acceptance for those three optimizations. |

### Exact scope worth preserving from the old candidate

If another phase is approved, do not cherry-pick `75e0d182`. Reimplement only
these semantics on a fresh worktree from current `dev`:

1. Keep the cacheable system-prompt prefix user-stable; append project ID,
   project paths, project memory, and any other project-scoped state at the end.
2. Start Skill-manifest and memory reads concurrently, and prefetch the system
   prompt while `buildPromptContext()` runs; preserve an inline fallback when
   prefetch fails.
3. Overlap only read-only route gates. Preserve allowlist, exact provider/model,
   billing, idempotency, one-run/one-attempt, Fast Lane, event-log replay, and
   durable recovery. Treat `requireCredits` as side-effecting.

Contract risks that must be explicitly checked: user/project memory placement,
provider cache-key behavior, rejected-request billing side effects, concurrent
duplicate reads, and reconnection to the same run without a second model call.

### Minimum next gate

- Freeze the current Production and current-`dev` baseline before changing code.
- Use fresh empty projects and the same prompt/account/provider/model; retain all
  failures and outliers and do not rerun samples.
- Test project-page and project-list entry paths separately, at least six samples
  per compared provider/path, and compare P50, P75, valid rate, and tail.
- Verify natural model output, exact provider/model, no hardcoded greeting or
  Fast Pass, zero unintended tool calls, one run/attempt, message 0→2, and
  refresh/reconnect to the same durable run.
- Release only if speed improves without quality/capability regression; otherwise
  keep the current Production deployment and close the candidate.

