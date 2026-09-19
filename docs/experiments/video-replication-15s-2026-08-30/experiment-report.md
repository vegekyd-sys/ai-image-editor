# 15-second video replication experiment

Date: 2026-08-30

Status: local-only experiment in isolated worktree

Overall result: **Part 1 passed; Part 2 partially passed; not ship-ready**

## Executive result

The Skill can turn this reference into a useful, machine-readable Shot Blueprint. A single Seedance 2.5 reference-to-video call reproduced the three-act timing and fade rhythm surprisingly well, but failed exact composition and typography. The result supports a Skill-first hybrid route, not a promise that one whole-video generation call can deliver a precise replica.

## Reference selection

The workspace contained ten MP4 files. Six were downloaded competitor-ad assets and were excluded from provider use. The selected source is the repository-owned `makaron-intro_2026-05-07_02-05-55.mp4`: 15.000s, 1080x1920, 30fps, H.264, no audio.

Its observable grammar is:

1. 0.000-5.017s — centered brand hook, reveal/hold/fade.
2. 5.017-10.517s — four-row feature proof, stagger/hold/fade.
3. 10.517-15.000s — centered CTA, progressive reveal/final hold.

The `1.133s` detector candidate was rejected during frame review because it is internal logo reveal motion, not a new shot.

## Part 1 — Skill understanding

Result: **PASS**

- Local FFprobe and full decode established file truth.
- The deterministic extractor found two black/fade anchors and three contiguous source ranges.
- Frame review added narrative role, subject action, layout anchors, transition interpretation, text layers, preserve/replace lists, and confidence.
- Reviewed Blueprint validates against `shot-blueprint.schema.json`.
- ASR and beat extraction are explicitly `not_applicable` because the source has no audio.
- The output contract is not prose alone: `shot-blueprint.reviewed.json` is the machine input to route selection, generation, composition, and QA.

## Part 2 — video-model replication

Result: **PARTIAL PASS**

One Seedance 2.5 `reference-to-video` generation was submitted at 480p, 15s, 9:16, silent. No reroll was made.

- Task: `task-unified-1788023357-rdbot51d`
- Provider elapsed time: 187s
- Official provider estimate at submission: up to $2.52 for 30 billable video-reference seconds at $0.084/s.
- Observed Makaron balance: 33086 -> 31913, a 1173-credit interval delta. This is not an itemized ledger and uses a different unit from EvoLink's published credit figure.

### What passed

- Final MP4 fully decodes: H.264/yuv420p, 480x854, 24fps, silent.
- Output has 361 frames versus a 360-frame 15s target: one extra output frame.
- Shot count/order is exactly 3/3.
- Output boundaries are 4.750s and 10.479s versus 5.017s and 10.517s.
- Median boundary error is 3.66 output frames.
- Shot-duration-curve MAPE is 3.76%.
- Both transitions remain fades through black.
- The locked-camera, black/violet, staggered-reveal language is strongly retained.
- Original Makaron wordmark, URL, and claim are absent.

### What failed

- The stricter boundary P95 is 6.41 frames, above a five-frame deterministic target.
- Bright-pixel composition-center deltas at representative frames are 17.38%, 7.86%, and 27.57% of the frame diagonal. Shots 1 and 3 move much lower/closer to center than the reference.
- OCR found `reboult`, duplicated `Video Blueprint`, and `Automatic QO`; exact copy therefore fails.
- The top sparkle remains too close to the source mark, so surface-identity replacement is incomplete.
- Camera/motion was reviewed from frames as locked, but optical-flow/global-motion QA is not yet implemented.
- Color/style similarity has visual evidence but no project-calibrated Delta E or histogram threshold yet.

## Decision

The whole-video generative route is useful as a structural style transfer, not as final delivery for text-heavy motion graphics. The recommended P0 is route C:

1. lock Blueprint timing and transitions;
2. use generation only for visual footage or motion that cannot be built deterministically;
3. recreate typography, logos, layout, fades, final hold, and any audio/caption timing in editable Remotion;
4. run the same post-export structural QA on the real MP4;
5. regenerate only a failing visual shot, never the whole timeline for a text/layout miss.

For this particular sample, route A with a fresh Remotion composition may be enough; paying a video model adds typography and identity risk without adding meaningful camera/action capability.

## Evidence map

- `shot-blueprint.raw.json` — deterministic first pass.
- `shot-blueprint.reviewed.json` — semantic Video DNA and route/QA contract.
- `reference-contact-sheet.jpg` / `reference-boundaries.jpg` — source review evidence.
- `provider-prompt.txt` / `acceptance-plan.md` — submitted intent and cost gate.
- `seedance-2.5-replica-attempt-1.mp4` — downloaded provider output.
- `output-shot-blueprint.raw.json` / `output-contact-sheet.jpg` — output analysis.
- `comparison-keyframes.jpg` — rows at 2s, 7s, and 13s; reference left, output right.
- `output-2s.png`, `output-7s.png`, `output-13s.png` — OCR evidence.
- `qa-result.json` — machine-readable acceptance vector.

## Smallest next experiment

Do not reroll the whole clip. Build the same 15s Blueprint as a minimal Remotion composition using deterministic text and layout, optionally retaining only a model-generated background/motion plate. Compare it with this attempt on the same metrics. That A-vs-C experiment will reveal whether a provider contributes enough visual value to justify its cost and instability.
