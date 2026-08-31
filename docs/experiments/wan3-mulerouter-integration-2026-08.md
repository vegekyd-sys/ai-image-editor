# Wan 3.0 MuleRouter integration (2026-08-31)

## Active routes

- Makaron `wan-3.0` -> MuleRouter
  `/vendors/carrothub/v1/w3.0-video/generation`
- Makaron `wan-3.0-pro` -> MuleRouter
  `/vendors/carrothub/v1/berry-1.0-pro/generation`
- Authentication uses `MULEROUTER_API_KEY`. The key is environment-only and
  must not be committed.

Official contracts:

- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/w3.0-video/generation
- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/berry-1.0-pro/generation

## Shared input contract

- Duration: integer 2-30 seconds, or `-1` for smart duration.
- Ratios: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, or `adaptive`.
- Standard resolutions: 480p, 720p, 1080p (default 1080p).
- Pro resolutions: 1080p, 2K, 4K (default 1080p).
- One image uses keyframe mode (`first_frame`). Mixed/multiple inputs use
  reference mode (`reference_images`, `reference_videos`, `reference_audios`).
- Reference limits: 10 images, 5 videos, 5 audios, 20 total.
- Reference videos: URL-only MP4/MOV, each 1-15 seconds and <=100MB, <=15
  seconds total, side 240-4096px, ratio <=8:1.
- Reference audios: URL-only WAV/MP3, each 1-15 seconds and <=15MB, <=15
  seconds total.
- Keyframe and reference modes are mutually exclusive.

## Makaron routing

- Submitted task IDs are wrapped as `mr-wan30-<uuid>` or
  `mr-wan30-pro-<uuid>` so all polling paths route back to the correct endpoint.
- App polling, video snapshots, agent runs, cron recovery, MCP status, CLI, and
  project-history restoration recognize both prefixes.
- Evolink remains active for Seedance only; Wan-specific Evolink branches were
  removed.
- The product default remains `seedance-fast`; Wan is selected explicitly.

## Verification

Implementation/unit/CLI/build results and live artifact paths are recorded in
the completing commit/turn. A provider task submission alone is not treated as
visual acceptance; each completed MP4 must be downloaded and inspected.
