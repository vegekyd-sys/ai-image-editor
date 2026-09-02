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

