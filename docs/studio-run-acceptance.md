# Studio Run Vertical Slice Acceptance

This worktree implements the first Makaron Studio Run vertical slice without
replacing the existing direct creative paths.

## Product Contract

- Acceptance must enter through the real worktree CLI path: `makaron chat`,
  followed by `makaron responses get <run-id> --wait --json`.
- A golden script or direct controller test is supporting evidence, not an E2E
  acceptance substitute.
- Quick Create behavior remains unchanged.
- `explainer-video` can opt into an eight-stage Studio Run.
- Every stage writes a schema-valid, versioned artifact.
- A run can be loaded and resumed from workspace state.
- Rewriting an upstream artifact invalidates only its transitive dependents.
- `approvalPolicy=auto` advances gated stages and records decisions.
- Guided/manual runs stop at required approval stages.
- The latest run and all deliverable paths are visible in the project CUI.
- Final delivery contains both an editable Remotion source and a rendered MP4.
- The CLI response must expose a `studio_run` output whose final state is
  `completed`, with all eight stage artifacts completed in one persistent run.

## Quality Contract

- Existing relevant Agent, workspace, Remotion, preview, and export tests pass.
- New controller, persistence, API, and UI tests pass.
- Golden MP4 has the promised duration, resolution, frame rate, and audio stream.
- Representative opening, scene, and ending frames are visually inspected.
- Final audio is checked for integrated loudness, true peak, and unexpected silence.
- Final review cannot pass while technical, visual, audio, or runtime checks fail.
- OpenMontage AGPL source is not copied into Makaron; implementation is clean-room.
