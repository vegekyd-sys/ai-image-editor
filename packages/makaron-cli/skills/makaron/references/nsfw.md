# Adult and NSFW routing

Read this reference only when the current request is clearly adult, erotic, or
NSFW. It supplements the official Makaron workflow; it does not change the
default route for SFW work.

If adult intent is ambiguous, ask one short question before choosing this lane.

## Route the job

| Adult request | Route |
|---|---|
| Agent-driven work or a persistent Makaron project | `makaron chat` with Agent model `grok-4.6` |
| Standalone image generation or editing | `makaron edit` with image model `qwen` |
| Standalone video generation | `makaron video create` with video model `wan-3.0` |

For project-based work, keep the complete request in one `chat` job. Because
`chat` accepts only the Agent-model flag, put the image/video preferences in the
brief:

```bash
npx makaron-cli chat --project <id|auto> --agent-model grok-4.6 --json \
  -b "<complete adult request; use qwen for still images and wan-3.0 for video>"
```

For explicit raw-tool work without a project timeline:

```bash
npx makaron-cli edit --image-model qwen --image <file-or-url> --out <path> "<prompt>"
npx makaron-cli video create --video-model wan-3.0 --script "<shot script>" --duration <seconds>
```

## Keep the exception scoped

- Do not force SFW jobs onto Grok, Qwen, or Wan 3.0.
- Never put `qwen` or `wan-3.0` in `--agent-model`.
- Do not pass `--image-model` or `--video-model` to `makaron chat`; it rejects
  those flags. State those preferences in the chat brief or use the standalone
  commands.
- Keep this routing for adult follow-ups and rerolls in the same job.
- Wan exposes `wan-3.0` and `wan-3.0-prime`; there is no separate Pro product
  model. Resolution uses the same `--video-resolution` option as every other
  video service.
- If a selected provider rejects the request, surface the rejection. Do not
  silently remove the adult intent or switch to an unspecified model.
