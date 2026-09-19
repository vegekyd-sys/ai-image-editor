# FAL H3 Max default Preview acceptance

- Worktree: `codex/h3max-reference`.
- Merged verified latest dev `9687f9fedf4ef31d253256b9ed8ffea9843ca0b8` in merge commit `858182cb`.
- Preview code: `acb9a05d` (public CLI Skill mirror included).
- Preview: https://ai-image-editor-nbbak5vnu-vegekyd-sys-projects.vercel.app
- User explicitly requested FAL H3 Max replace Seedance 2.0 Fast as the normal default. App, Agent (layered and legacy prompts), CLI and MCP now default to `fal-h3-max`, 768p. Explicit model choices, including Turbo skills, still win. Existing specialized replication, NSFW and 16–30s routes remain.
- No production app deployment. No new shared database or environment changes in this merge/default turn; H3 pricing migration was already applied previously.

## Validation

228 tests across 21 relevant suites passed. Core prompt ownership/legacy contracts passed (54 paragraphs, 12 protected files, 2 bundles). Lint, TypeScript, CLI smoke, clean local webpack build and Vercel build passed. Local stale `.next` cache was moved aside after an initial build failure.

Two real requests on this exact Preview omitted the video model:

| Path | Result | Billing |
| --- | --- | --- |
| Agent chat with one reference image, 5 seconds, no model or resolution named | `fal-h3-max`, 768p, `minimax/h3-max/reference-to-video`; completed and persisted on CDN | 80 credits |
| CLI/MCP reference-video book recolor, 5 seconds | `fal-h3-max`; provider URL in 36.03s including upload/submit/poll; HTTP 206 video/mp4 | 219 credits; reservation completed |

Agent test project: https://ai-image-editor-nbbak5vnu-vegekyd-sys-projects.vercel.app/projects/98b49532-a3eb-4cd3-a5e6-d069de21a02f

Reference task: `fal-h3max-reference-01a072a5-d3b3-7592-82e6-cf4b6e9b9be5`.
Agent task: `fal-h3max-reference-01a072a6-1739-7823-af24-ef4b121246be`.
Both complete video files decoded with FFmpeg without errors. Extracted frames visually verified: reference edit has the blue book with both people and bookstore retained; Agent output shows the reference character holding the red book.

Browser automation timed out in Chrome and the in-app browser; in-page playback was not verified in this turn. Direct Mac networking reset; the existing system proxy allowed successful Preview API access and media checks. No network settings changed.

Evidence: local ignored `artifacts/h3max-dev-merge/` contains tests, deployment output, submission receipts, final snapshots, billing and frame/decode checks.
