# TODO: Agent runtime feedback and self-improvement loop

Status: deferred until the open coding runtime is validated in production.

## Product rule

The feedback system must help the Agent repair its own program; it must not stop
the Agent merely because a failure may belong to the Harness, Sandbox, media
input, or infrastructure. Users should see the requested artifact, not an
internal ownership dispute.

When a run fails, preserve the saved source and return the exact compiler,
runtime, dependency, media, and process output to the Agent. The Agent should
continue patching the same program. The platform may transparently normalize
media, install a missing package, recreate an expired Sandbox, or switch to a
compatible executor, then give control back to the Agent.

## Deferred implementation

- Persist a versioned execution diagnostic on existing `agent_events` and
  `agent_tool_history`: phase, error code, fingerprint, Harness version, Sandbox
  version, source hash/path, raw error, attempted recovery, and final outcome.
- Cluster repeated fingerprints across runs and turn confirmed platform
  failures into minimized regression fixtures.
- Track first-run success, repair turns before success, repeated-fingerprint
  count, Harness false positives, Sandbox failures, and time to first artifact.
- Replay the real failure corpus against every Harness/Sandbox change.
- Let the Agent keep repairing while the platform performs bounded automatic
  recovery. Only the overall Agent execution budget/user cancellation may end
  the attempt; a platform-suspected error alone must not end it.
- Later self-iteration gate: create an isolated worktree, generate the regression
  test first, patch the runtime, run unit/build/real-media smoke, and request
  human approval. Do not auto-merge or auto-deploy until explicit standards are
  accepted.
