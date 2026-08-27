# Studio workflow inside Agent Run

## Decision

`agent_runs` is Makaron's only model-facing and schedulable execution.

Studio is a workflow skill invoked inside an Agent Run. Its stage state and
artifacts are durable, but it is not a second runner and cannot be recovered,
scheduled, or adopted independently.

```text
Agent Run
├── model conversation
├── durable attempts, lease, retry, and recovery
├── context snapshots and input inbox
└── Studio workflow invocation
    ├── typed stages
    ├── artifact manifest
    └── Studio UI projection
```

## Invariants

1. Every newly created Studio workflow state has one `agentRunId`.
2. `studio_run` may only read or mutate the workflow belonging to the current
   Agent Run.
3. Agent context, recovery checkpoints, work-unit resolution, and Composition
   scaffolding must filter Studio state by the current Agent Run ID. Project-
   scoped "find the active Studio Run" behavior is forbidden.
4. A new instruction received while a durable Agent Run is active is appended
   to `agent_run_inputs`. It must not abort that run or create a second Agent
   Run for the same in-progress objective.
5. The runner applies queued inputs at a durable work-unit boundary. An
   `input_version` compare-and-set prevents an attempt from completing if a new
   instruction arrived while the model was working.
6. Legacy Studio records without `agentRunId` remain readable for project UI,
   but a new Agent Run must never adopt or mutate them.
7. Before every durable Studio mutation, preview, publish, or media
   materialization, the attempt compares its claimed `input_version` with the
   Agent Run. A newer instruction forces a handoff before the old target can
   produce another side effect.
8. A running Studio workflow does not itself keep an Agent Run alive. When the
   newest instruction pauses export or waits for review, the Agent Run may
   complete while the Studio workflow remains durably at Review.

## Runtime admission

- No active Agent Run: create a new Agent Run.
- Active durable Agent Run: append the instruction and return the same run ID.
- Active legacy/non-durable Agent Run: return a conflict instead of silently
  superseding it.
- Explicit user stop still uses the Agent Run abort endpoint. Stopping an
  Agent Run does not authorize another Agent Run to adopt its Studio state.

## Persistence

`agent_run_inputs` is the durable inbox. `input_version` on `agent_runs`
provides the completion race guard. Studio stage JSON remains in the project
workspace as a nested workflow snapshot and artifact manifest.

The workspace path retains the historical `studio-runs` name for compatibility;
that path does not define an independent execution lifecycle.

## Acceptance cases

1. Agent Run A starts Studio workflow S. A second CLI instruction returns A's
   run ID, and S continues under A.
2. A new Agent Run cannot load, invalidate, or advance S.
3. A queued instruction arriving during attempt N forces a handoff to attempt
   N+1 instead of letting N mark the Agent Run completed.
4. Restarting the worker resumes Agent Run A and its bound Studio stage.
5. A legacy unbound Studio record is never automatically selected by a new
   Agent Run.
6. If A originally targets an MP4 and a queued instruction changes the target
   to "leave the editable draft at Review", no materialization or Delivery
   mutation occurs after that input version is observed.
7. The Agent Run completes after reporting the reviewable draft, while the
   nested Studio workflow remains resumable at Review.
