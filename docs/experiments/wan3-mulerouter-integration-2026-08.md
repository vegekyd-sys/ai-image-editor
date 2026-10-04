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
- All media inputs use reference mode (`reference_images`, `reference_videos`,
  `reference_audios`), including a single image. Makaron does not send Wan
  images as `first_frame`.
- Reference limits: 10 images, 5 videos, 5 audios, 20 total.
- Reference videos: URL-only MP4/MOV, each 1-15 seconds and <=100MB, <=15
  seconds total, side 240-4096px, ratio <=8:1.
- Reference audios: URL-only WAV/MP3, each 1-15 seconds and <=15MB, <=15
  seconds total.
- Keyframe and reference modes are mutually exclusive; Makaron intentionally
  exposes only the reference path for Wan media inputs.

## Makaron routing

- Submitted task IDs are wrapped as `mr-wan30-<uuid>` or
  `mr-wan30-pro-<uuid>` so all polling paths route back to the correct endpoint.
- App polling, video snapshots, agent runs, cron recovery, MCP status, CLI, and
  project-history restoration recognize both prefixes.
- Evolink remains active for Seedance only; Wan-specific Evolink branches were
  removed.
- The product default remains `seedance-fast`; Wan is selected explicitly.

## Pricing and Makaron credits

MuleRouter bills only output resolution unit price multiplied by output seconds;
audio and media references do not add a separate charge. Makaron applies its
standard 2x markup and rounds the whole run up to a full credit:

| Model | Resolution | Supplier cost | Makaron credits / second |
| --- | --- | ---: | ---: |
| Wan 3.0 Standard | 480p | $0.05/s | 10 |
| Wan 3.0 Standard | 720p | $0.10/s | 20 |
| Wan 3.0 Standard | 1080p | $0.20/s | 40 |
| Wan 3.0 Pro | 1080p | $0.18/s | 36 |
| Wan 3.0 Pro | 2K | $0.20/s | 40 |
| Wan 3.0 Pro | 4K | $0.23/s | 46 |

Every registered video model must declare explicit provider pricing; tests fail
if a model omits it, and runtime submission fails closed instead of falling
through to a generic video estimate.

## Verification

Implementation/unit/CLI/build results and live artifact paths are recorded in
the completing commit/turn. A provider task submission alone is not treated as
visual acceptance; each completed MP4 must be downloaded and inspected.
