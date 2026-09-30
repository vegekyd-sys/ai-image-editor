# Multi-angle product skill: real model comparison

Tested 2026-09-30 on branch `codex/multi-angle-video` using Makaron CLI,
the user's authorized account, and the candidate local API. No deployment.

## Protocol

- Source: https://x.com/influencer_seo/status/2104983795854434684/video/1
- The supplied video is already a stacked original/AI comparison. Only the top
  original shot was used: first 15.000 seconds, 1280×720, 24 fps, original audio.
- The product skill analyzed that prepared source, persisted source ASR and
  action anchors, and produced a contiguous six-shot coverage plan. Both models
  received the identical prepared source and 993-character story prompt.
- Source-frame anchors are approximate (about ±0.25 seconds), not framewise
  motion ground truth. Regional video-understanding access failed; actual frames
  and FFmpeg probing were used instead.
- Completed outputs were downloaded, fully decoded, sampled at 2 fps, checked
  for hard-cut candidates, and separately transcribed once. ASR boundaries are
  speech-timing evidence, not proof of lip synchronization or untouched audio.
- Native outputs were imported into the user's project. H3 also has a local
  15.000-second presentation copy trimming only its trailing 0.104 seconds,
  retaining generated sound (audio re-encoded). The original remains intact.
- A muted three-panel comparison covers the common first 14.708333 seconds,
  without freezing, stretching, or padding the shorter Seedance result.

## Observed results

| Model | Native output | Cut candidates (seconds) | Speech QA | Material failures |
| --- | --- | --- | --- | --- |
| Seedance 2.5, Evolink reference-to-video | 1280×720; video 14.708333s, audio/container 14.720s | 4.208, 5.875, 8.542, 12.167 | Same recognized dialogue; utterance start/end differences 0.01–0.02s | Visible invented camera in shoulder view; missing source tail; planned six-shot timing not followed |
| FAL H3 Max, video reference | 1344×768; video 15.083333s, audio/container 15.104s | 2.417, 5.083, 7.375, 9.042, 11.042 | Same recognized dialogue; second utterance about 1.0–1.1s early | Invented background window; redirected eyeline; performance/cut timing drift |

Both are generated, playable candidates. Neither passed the skill's complete
source-clock/scene-preservation acceptance. No original-audio swap was used to
hide drift. Seedance is the more promising default for preserving speech timing
in this sample; this single case does not establish universal model superiority.

## Runtime defect and correction

The first Seedance request used explicit duration 15, which the provider rejected
as an editing-style reference request requiring `duration=-1` and adaptive ratio.
The corrected second request still failed because MCP billing changed `-1` to
five seconds, which then caused a 16:9 ratio. Both failures were fully refunded.

The fix preserves the source-following provider sentinel while quoting measured
source seconds. A regression first reproduced the incorrect five-second quote,
then verified a 15-second quote and the actual provider request body containing
`duration=-1`, `aspect_ratio=adaptive`. Existing smart defaults remain unchanged.
The third Seedance submission completed successfully after this correction.

Validation: 7 Seedance integration tests, 18 related pricing/billing tests,
targeted ESLint, startup-manifest contract, reference-workflow contract, and
`git diff --check` passed. Earlier skill selector checks covered four locales
and desktop/mobile layouts.

The skill now explicitly prohibits materializing virtual camera positions as
visible cameras, tripods, filming equipment, or crew. That prompt correction has
not received a new paid generation; the reported outputs precede it.

## Receipts

- Planning run: `e91608db-2120-4535-bf79-cdbf4b908f60`.
- H3 task: `fal-h3max-reference-01a0f2c1-90d3-7403-94e1-0812d08218d4`.
- Successful Seedance task: `task-unified-1790780032-30ru1zin`.
- Native audio QA runs: H3 `eeceffcf-4580-44f1-be09-3117b215a5d9`,
  Seedance `5b0d683c-2be3-4e51-960f-d324e382bb81`.
- Charged: H3 672 credits, successful Seedance 975 credits; net 1,647 credits.
  Failed charges 975 and 325 were each refunded in the usage ledger.
- Local evidence directory:
  `/Users/tianyicai/Documents/Codex/2026-09-30/multi-angle-video-test/`.
  Contains submitted source/prompt/plan, native videos, ffprobe/ASR QA, CLI
  receipts, decoded contact sheets, and `comparison-muted.mp4`.

Workflow inspiration: https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5
