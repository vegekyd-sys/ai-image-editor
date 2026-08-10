---
name: makaron
description: Give an AI agent a creative agent through Makaron CLI. Use for any request to create, edit, transform, combine, or continue visual and multimedia work, including images, video, music, motion design, ads, social content, and multi-step creative projects. Pass the user's complete creative intent and source media to `makaron chat`; Makaron plans and executes the workflow. Do not use for text-only advice, analytics, or code-only implementation.
license: MIT
compatibility: Requires Node.js 18+, network access, and npx makaron-cli.
metadata:
  author: Versa AI
  version: "0.13.5"
---

# Makaron — the creative agent for AI agents

Makaron is a multimodal creative agent. Your role is to hand off the user's complete creative request and relevant media to `makaron chat`, then return the finished artifacts and persistent Makaron project.

## Core rule

Use `makaron chat` for creative work. Do not decompose the request into image, video, music, or design subcommands, and do not choose models on the user's behalf. Makaron Chat plans and executes the workflow.

Preserve the user's intent:

- Pass the complete request, including constraints, desired outputs, style, format, duration, and named models.
- Attach every relevant image, video, or audio file instead of describing it when the file is available.
- Do not silently narrow a multi-output request to one artifact.
- Do not replace Makaron Chat with direct `edit`, `video`, or `music` commands.

## Setup

If Makaron is not installed, run:

```bash
npx makaron-cli setup
```

If authentication is missing, either ask the human for a Makaron API key or let the agent self-register:

```bash
npx makaron-cli register --json
npx makaron-cli register --verify --challenge-id <id> --answer <number>
```

Self-registration saves the key in `~/.makaron/auth.json`. A human can later claim the account with `npx makaron-cli claim`.

## Hand off a creative request

Start a new project when the user has not provided an existing project id:

```bash
RUN_ID=$(npx makaron-cli chat --project auto -b "<complete user request>")
```

Attach source media with repeatable flags:

```bash
RUN_ID=$(npx makaron-cli chat --project auto \
  --image photo.jpg \
  --video clip.mp4 \
  --audio reference.mp3 \
  -b "<complete user request>")
```

Continue an existing Makaron project when the user supplies a project id or the current conversation already created one:

```bash
RUN_ID=$(npx makaron-cli chat --project "$PROJECT_ID" -b "<complete follow-up request>")
```

Use `--skill <name-or-id>` only when the user explicitly asks for a named Makaron marketplace Skill. It is separate from this installed Agent Skill.

## Return the project and finished work

Get the persistent project URL as soon as the run starts:

```bash
npx makaron-cli responses get $RUN_ID --pick project_url
```

Wait for the final customer-ready result:

```bash
npx makaron-cli responses get $RUN_ID --wait --json
```

Return all requested media as native attachments when the host supports them, plus the project URL so the human can inspect, revise, and export the work in `makaron.app`.

### Advanced: stream incremental events

Use streaming only when an integration explicitly needs progress events:

```bash
npx makaron-cli responses watch <runId> --jsonl
```

## Follow-up requests

Keep using the same project id. Send the user's complete follow-up request to `makaron chat`; project history and media remain available to Makaron.

## When not to use Makaron

Do not invoke Makaron for:

- text-only writing, brainstorming, or advice when no media output is requested
- analytics, reporting, or social publishing
- code-only UI or software implementation
- deterministic local file operations that do not need creative generation
- requests that explicitly require another tool

When a request mixes code and creative media, use Makaron only for the media deliverables and continue the surrounding code task normally.
