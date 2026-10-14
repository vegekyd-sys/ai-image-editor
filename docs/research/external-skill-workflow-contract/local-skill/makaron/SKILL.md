---
name: makaron
description: "Create or edit media with Makaron when requested or selected; manage project runs and deliver final assets."
---

# Makaron CLI

Use Makaron for the user's selected creative task. Prefer `makaron chat --project` for conversational work and persistent timelines; use direct `edit`, `video`, or `music` commands for requested models/tools or standalone outputs. A Makaron repository code task alone does not require creative generation.

## Normal path

Use the installed `makaron` command, or `npx makaron-cli` when unavailable. Check the relevant `--help` only when flags or behavior are uncertain. Existing auth is in `MAKARON_API_KEY` or `~/.makaron/auth.json`; never display it. Setup is needed only when auth is absent or the user requests it.

```bash
makaron chat --project auto --image photo.jpg -b "make it cinematic and create a 5s video"
# Use the returned run ID:
makaron responses get <runId> --wait --json
```

Use an existing project ID when continuing its timeline; omit `--image` for text-only requests. `chat` defaults to automatic routing. The installed CLI supports `--agent-model` for an explicitly requested Agent LLM; confirm supported IDs with `chat --help`. Image/video model flags and legacy `--model` do not belong to `chat`; use the corresponding direct command when a specific media model is required.

## Internal production workflows

For an explicitly selected internal workflow, use `chat --skill <exact-name>`.
Read [internal workflows](references/internal-workflows.md) for discovery,
long-video/replication/explainer selection, delegated review and production evidence.
Atomic tool calls and reading a Skill alone do not start that internal workflow.

## Completion and scope

- One active run per project: a new message can interrupt the previous run. Resume/status-check a known run instead of submitting duplicates.
- Wait for final requested media unless the user asked only for submission. An in-progress response or a timeout is not completion; use its run ID to continue. Follow `next_poll_after_ms` when polling.
- A design/JSON artifact alone is not an exported MP4. When MP4 is requested, finish the corresponding export and inspect a downloadable, playable result. Return concise artifact/project links and state any actual failure.
- Read-only diagnosis and finishing the authorized run can continue autonomously. A retry that creates a new paid generation requires checking the existing task and its authorization/budget first.
- Reply in the current conversation. Sending through another app or to another recipient requires explicit authorization covering that destination; a service-flow example is not authorization.

## Read only the relevant reference

| Need | Reference |
|---|---|
| Register, authenticate, claim an account, check credits | [setup](references/setup.md) |
| Existing timeline, video/audio input, screenshot-directed edits | [project media](references/project-media.md) |
| Browse/use skills or authorized marketplace administration | [marketplace](references/marketplace.md) |
| Standalone image, video, or music tools | [direct tools](references/direct-tools.md) |
| Response fields, exit codes, polling or incremental integration | [responses](references/responses.md) |
| Export an editable composition or JSON to MP4 | [materialize](references/materialize.md) |

Reference examples are usage aids. Consult current command help for changed provider capabilities, defaults and flags; do not treat old duration estimates as completion signals. Use `watch --jsonl` only when incremental events are useful to the requested integration.
