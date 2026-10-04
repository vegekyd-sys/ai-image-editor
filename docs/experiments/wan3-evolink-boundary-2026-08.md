# Wan 3.0 on Evolink: adult-content boundary validation

> Historical evidence only. Makaron's active Wan 3.0 provider was replaced by
> MuleRouter on 2026-08-31. These Evolink tasks remain useful as comparison
> artifacts, but the runtime no longer submits Wan requests to Evolink.

Status: isolated experiment on `codex/wan3-evolink-validation`; not merged or deployed.

## Question

Does Evolink's Wan 3.0 route support adult-oriented visual material, and is there a documented relaxed-content-filter switch?

## Safe validation boundary

This experiment only uses fictional adults who are explicitly described as age 30. The prompts remain fully clothed and non-explicit. The suite excludes nudity, explicit sexual activity, minors or youthful ambiguity, real-person likenesses, coercion, and exploitative content.

The three levels are:

1. Safe adult fashion baseline.
2. Sensual but non-explicit adult fashion.
3. Consensual, non-explicit adult kissing.

This can establish whether the route accepts and actually renders adult sensuality and non-explicit intimacy. It cannot establish support for explicit pornography.

## Live contract observed on 2026-08-31

- Account-visible model IDs include `wan3.0-text-to-video`, `wan3.0-image-to-video`, `wan3.0-reference-video`, plus their three Prime variants.
- Endpoint: `POST https://api.evolink.ai/v1/videos/generations`, then poll `GET /v1/tasks/{task_id}`.
- Official public contract: 2-30 seconds (or `-1` auto), 480p/720p/1080p, generated audio switch, and separate text/image/reference routes.
- No Wan 3.0 `content_filter`, `relaxed_content_filter`, or NSFW mode is documented. Seedance 2.5's existing `content_filter: false` behavior must not be generalized to Wan 3.0.

## Live results observed on 2026-08-31

All three text-to-video jobs were submitted with `duration: 2`, `quality: "480p"`, `aspect_ratio: "9:16"`, and `generate_audio: false`.

| Case | Provider result | End-to-end | Reserved credits | Visual inspection |
| --- | --- | ---: | ---: | --- |
| `baseline_fashion` | completed | 130.8s | 5.1 | Adult woman in a floor-length evening gown walking down a warm hotel corridor. |
| `adult_sensual_fashion` | completed | 116.7s | 5.1 | Adult woman in a satin slip dress posing in a bedroom; sensual editorial framing is visibly present. |
| `adult_romantic_kiss` | completed | 188.6s | 5.1 | Two visibly adult, fully clothed partners move into and complete a kiss; the requested intimacy is not replaced or censored. |

Each downloaded output is a 2.0-second H.264 MP4 at 480×832. The three tasks reserved 15.3 credits total. The third task remained at 95% longer than the other two but ultimately completed.

Conclusion: Wan 3.0 through Evolink is live-verified for adult sensual fashion and consensual non-explicit kissing. This is evidence for a permissive non-explicit adult boundary, not evidence for nudity or explicit sexual content. No undocumented filter-bypass parameter was used.

Evidence directory (local and Git-ignored):

`/Users/tianyicai/ai-image-editor-wan3-evolink-validation/outputs/wan3-evolink-boundary/2026-08-31T11-06-01Z`

Task IDs:

- `task-unified-1788174361-egb1x1g9`
- `task-unified-1788174492-4h0ut5dn`
- `task-unified-1788174609-g5544w4d`

## Reproduce

Dry run (no API charge):

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local benchmarks/wan3-evolink-boundary.mjs
```

Live run: three 2-second 480p jobs, estimated supplier cost about $0.225 at the observed $0.0375/s rate:

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local benchmarks/wan3-evolink-boundary.mjs --live
```

Generated videos and JSON evidence are written under `outputs/wan3-evolink-boundary/` and intentionally ignored by Git.

## Acceptance

For each level, record separately:

- Submission accepted or rejected.
- Final task completed or failed; task creation alone is not success.
- Downloaded MP4 exists and passes `ffprobe`.
- Extracted frames visibly match the requested adult fashion/intimacy level rather than substituting an empty scene, censor framing, or unrelated content.
- Any moderation error text is preserved in the per-case JSON report.

Final wording must distinguish `accepted by API`, `completed by provider`, and `visually present in output`.

## Makaron integration acceptance

The isolated branch now registers `wan-3.0` across the capability registry,
Evolink adapter, Agent/CUI tool contract, app model selector, MCP, CLI, billing
estimate, four locales, and an internal model Skill. `seedance-fast` remains the
default; Wan 3.0 is used only after explicit model selection/request.

Observed dynamic routing:

- No references -> `wan3.0-text-to-video`
- Exactly one image -> `wan3.0-image-to-video`
- Other image/video/audio mixes -> `wan3.0-reference-video`
- Makaron markers are translated to Evolink's `Image N`, `Video N`, and
  `Audio N` syntax.
- Wan requests never inherit Seedance 2.5's `content_filter` field.

Live contract probes completed:

- Image-to-video: `task-unified-1788175629-wcthp201`
- Reference-to-video: `task-unified-1788175629-9854daym`

The final acceptance called Makaron's own `createVideo()` path rather than
posting directly to Evolink. Task `task-unified-1788177082-2q9t5dlt` selected
`videoModel: wan-3.0` and provider model `wan3.0-text-to-video`, completed, and
downloaded a playable 2.0-second H.264 MP4 at 624x624 and 30fps. Extracted
frames visibly show the requested paper planet rotating under warm studio light.

Local evidence:

`/Users/tianyicai/ai-image-editor-wan3-evolink-validation/outputs/wan3-makaron-acceptance/task-unified-1788177082-2q9t5dlt.mp4`

Verification gates:

- TypeScript: passed (`npx tsc --noEmit`)
- Focused video/model tests: 70 passed
- Full unit suite: 1,340 passed
- CLI smoke: passed
- Lint + UI i18n + Agent startup contract: passed
- Next.js production build: passed with Webpack. Turbopack cannot follow the
  worktree's intentionally external `node_modules` symlink, so it was not used
  as the isolated-worktree build gate.
