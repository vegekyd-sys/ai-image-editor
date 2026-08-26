# Makaron Skill Evolution

Status: Phase 0 foundation in isolated worktree. No production deployment and
no automatic Skill mutation.

## Goal

Build a repeatable loop for three initial capabilities:

| Skill key | Source | Initial role |
| --- | --- | --- |
| `animate` | `src/lib/prompts/animate.md` | Direct short-video script and provider-generation contract |
| `tiktok-video` | `src/skills/tiktok-video/SKILL.md` | TikTok-native source-led packaging, captions, and delivery |
| `talking-head` | `src/skills/talking-head/SKILL.md` | Speech-led editing, B-roll, caption, and final-media contract |

The system should learn from real projects without confusing model quality,
source quality, renderer failures, or platform failures with Skill quality.

## Current production evidence

A read-only aggregate on 2026-08-24 found the following activity since
2026-07-25:

- 3,358 Agent Runs
- 455 reads of `prompts/animate.md`
- 287 reads of `skills/tiktok-video/SKILL.md`
- 62 reads of `skills/talking-head/SKILL.md`
- 752 `generate_animation` calls and 1,168 `run_code` calls

This is enough volume to start observation, but historical rows do not carry an
immutable Skill version. Phase 0 adds that missing join.

## The loop

```text
Observe exact Skill version
  -> assemble privacy-safe run evidence
  -> deterministic media gates
  -> model rubric + sampled human preference
  -> cluster repeated failures
  -> create one hypothesis and candidate diff
  -> replay matched cases in an isolated worktree
  -> small canary
  -> human promotion or rollback
```

The proposal generator may author a candidate diff, fixtures, and a report. It
must not merge, deploy, or change the production release channel by itself.

## Attribution before optimization

Every evaluated run needs four independent identities:

1. Skill: effective bundle SHA-256 (entrypoint, owned references, and declared
   shared dependencies) plus Git/deployment revision.
2. Agent/model: Agent model, provider model, retries, and tool trace.
3. Input: media type/count/ranges and non-sensitive technical metadata.
4. Output: final artifact, renderer/provider version, media probes, and user
   feedback signals.

Only failures that remain associated with one Skill version across varied
inputs/providers should become Skill-improvement evidence. Infrastructure and
provider failures go to their own clusters.

## Evidence hierarchy

From strongest to weakest:

1. Explicit human pairwise preference or reject/accept review.
2. Final artifact hard gates and inspected/decoded media.
3. Task-specific model rubric with evidence frames/time ranges.
4. User continuation behavior: save/share/publish, revision, regenerate, abandon.
5. Execution efficiency: retries, repair turns, time, and cost.

Weak behavioral signals never override a failed final-media gate. A missing
signal is `inconclusive`, not a failure and not a zero.

## Data model

Migration `20260824000000_skill_evolution.sql` adds:

- `skill_versions`: immutable content fingerprints, Git SHA, deployment metadata.
- `skill_run_usages`: exact Agent Run and project that used the version.
- `skill_run_evaluations`: versioned deterministic/model/human evaluations.
- `skill_improvement_proposals`: hypothesis, replay, canary, promotion lifecycle.
- `record_skill_run_usage(...)`: ownership-checked telemetry registration.

No Skill body, prompt, customer media, signed URL, or user text is copied into
these tables. Git stores Skill content; evaluation evidence should use durable
artifact IDs and bounded technical facts.

## Release gates

A candidate can advance only when:

- the failure cluster has enough independent projects to state a narrow
  hypothesis;
- the matched replay set freezes the user request, source media/ranges, model,
  delivery specification, and evaluator version;
- no hard-gate regression occurs;
- the primary metric improves beyond the predeclared threshold;
- a sampled human comparison does not prefer baseline;
- the candidate has a rollback target and a named human approver.

Initial recommendation: require at least 20 comparable observed runs to create
a proposal, 10 matched replay cases to enter canary, and 30 canary runs before
promotion. These are starting thresholds, not product truth; change them only
after measuring variance.

## Phases

### Phase 0: traceability (this worktree)

- Register the exact effective-bundle SHA when one of the three sources is
  read. Incomplete bundles remain observable but cannot enter replay or canary
  cohorts.
- Add deterministic evaluation contracts and storage schema.
- Establish privacy, attribution, and human-promotion boundaries.

### Phase 1: evaluator workers

- Backfill traceable historical reads when the full tool result is available.
- Resolve final output artifacts for each usage.
- Run `ffprobe`, full decode, duration/end-frame/audio checks, and Skill-specific
  validators.
- Store only bounded evidence and evaluator versions.

### Phase 2: review workbench

- Daily scorecard by Skill version and failure cluster.
- Pairwise baseline/candidate review with blinded ordering.
- Explicit approve/reject/reason controls; four-language product UI in the same
  change.

### Phase 3: proposal and replay

- Generate a candidate in a fresh `codex/skill-evolution-*` worktree.
- Add a regression case before changing the Skill.
- Replay matched cases and produce an evidence report.

### Phase 4: canary and promotion

- Deterministic project assignment and version pinning.
- Budget, sample-size, regression, and rollback guards.
- Human approval before exact-SHA promotion.

## Non-goals for v1

- Letting an LLM judge its own output without deterministic or human evidence.
- Updating a Skill from one angry or delighted session.
- Treating task completion, MP4 existence, likes, or saves as quality proof.
- Training on raw customer content by default.
- Auto-merging or auto-deploying proposed changes.
