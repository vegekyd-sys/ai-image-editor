# FAL H3 Max production acceptance — 2026-09-06

Production commit: `67d668a7`. Deployment: `dpl_AZDqWR4EXiKXzhnWWshbDRCuH7N2` (`ai-image-editor-4m3iyyfq2-vegekyd-sys-projects.vercel.app`). Both `www.makaron.app` and `makaron.app` were inspected and resolve to this Ready production deployment. Health returned HTTP 200. The approved four-language changelog is visible on the production projects page. Hosted MCP discovery and the public Agent Skill describe the H3 Max default and reference inputs.

The release was fast-forwarded into local `dev`. GitHub push was attempted but failed to connect to github.com:443; remote synchronization remains pending. Vercel deployed the local release successfully. The later acceptance script/report commit does not change the deployed application.

## Real hosted R2V timing

Mac → `https://www.makaron.app/api/mcp` → FAL H3 Max → hosted status polling → first observed video URL. This uses the same authenticated JSON-RPC interface as the CLI. No direct provider submission was used. 768p, 16:9, one generation at a time, approximately four-second polling intervals. Each group contains two valid samples; second-round order was reversed.

| Output | Image reference, mean (range) | Video reference, mean (range) |
|---|---:|---:|
| 5 seconds | 11.1s (10.7–11.6s) | 30.5s (29.9–31.1s) |
| 10 seconds | 15.8s (15.8–15.8s) | 35.2s (35.1–35.3s) |
| 15 seconds | 25.4s (25.4–25.5s) | 49.9s (49.6–50.2s) |

All video-reference cases used the same 5.184-second source clip. The prompt changes a red book to blue while preserving the man, olive jacket and bookstore. The image-reference prompt places the reference character in a bookstore handling a red book. Inputs were already uploaded. Times include authentication, billing, input validation, provider processing and hosted polling, and exclude Agent planning, initial upload, output download and later CDN persistence. These are small samples, not latency percentiles. They are not directly comparable with earlier direct-provider tests that varied source-video length with output length.

Raw valid URL times, seconds:

- Image 5s: 10.657252333, 11.630547084.
- Image 10s: 15.809766041, 15.835919750.
- Image 15s: 25.355281459, 25.492556083.
- Video 5s: 31.088846792, 29.854625125.
- Video 10s: 35.077697625, 35.297396541.
- Video 15s: 50.168300917, 49.615501208.

There were 13 billed MCP generations, all completed. The first image-5s run omitted the model and verified the hosted default. Its first status query failed because the acceptance harness accidentally included a trailing sentence period in the task ID. The exact existing task was recovered without resubmission; its timing was excluded and one replacement run supplied the second valid sample. The corrected harness reads the standalone Task ID line. No supplier-generation failures occurred.

## Media and billing acceptance

All 13 outputs returned video URLs and passed full-file FFmpeg decoding. They contain H.264 video, AAC audio, 1344×768 frames at 24 fps; actual durations are 5.184, 10.144 and 15.104 seconds. Representative video-reference frames show a blue book with the same character and bookstore.

All 13 MCP reservation rows have status `completed`, model `fal-h3-max`, and the exact submitted task ID. Image-reference charges are 80/160/240 credits for 5/10/15 seconds; the fixed video reference raises those charges to 219/299/379 credits. Total MCP test charge, including the excluded first sample: 2,834 credits. The test saves intent and a stable billing request UUID before submission and refuses blind reruns of incomplete receipts.

## Formal Agent and customer-path acceptance

A new production CLI chat requested the current default video model, without naming H3 Max, and directly approved the script. Project: [production acceptance project](https://www.makaron.app/projects/4185a2c9-5bd7-4415-8fca-6a73c76d7278).

- Run `bf05368e-bd9a-476d-8677-7ea8199462cc` completed in one execution attempt, owned by `https://www.makaron.app`.
- It analyzed the source and selected `fal-h3-max`; task `fal-h3max-reference-01a07460-7c78-7072-821a-c4c89f3eb400`. No fallback model was used.
- The complete CLI workflow, from new-project submission to completed-video receipt, took approximately 90.5 seconds. The response reported approximately 53 seconds for its video task. This has a different Agent-written prompt and includes additional planning/polling, so it is separate from the timing table.
- Video billing was 219 credits, plus 1 credit for source-video analysis. The personal Codex Agent usage was recorded at 0 credits.
- Snapshot `c8d421cf-bd9d-41b3-9acf-f47a38facf4c` persists `status: completed`, `model: fal-h3-max`, `providerModel: minimax/h3-max/reference-to-video`, source references, billing quote and permanent CDN video/poster URLs. This modern Agent path saves in `snapshots.video_meta`, not the legacy `project_animations` table.
- The production editor displayed “蓝色书替换”, “5s · fal H3 Max” and “视频已生成”. Its player played with audio and reached `0:05 / 0:05`. The final frame shows the man reading the blue book. The downloaded Agent output also passed full decoding.

[Permanent Agent output](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/4185a2c9-5bd7-4415-8fca-6a73c76d7278/videos/c8d421cf-bd9d-41b3-9acf-f47a38facf4c.mp4)

## Release checks and evidence

Full suite: 1,701 passed, 1 skipped across 278 files. Lint, UI i18n guard, startup/video contracts, CLI smoke and production build passed. A stale public Skill mirror exposed by the full test run was synchronized before deployment; hosted MCP descriptions were corrected and their focused tests passed. No production environment variables were changed.

Reproducible harness: `scripts/h3max-production-acceptance.mjs`. Local ignored evidence directory: `artifacts/h3max-production/`, including deployment inspections, production discovery/gate, per-case intent/receipts/polls, billing rows, downloaded media, full-decode checks, Agent submission/result and persistence evidence. Credentials are not included in the report or committed artifacts.
