# 15-second video replication acceptance plan

Status: local-only experiment in an isolated worktree. This is not merged, pushed, deployed, or a product-complete Studio Run.

## Reference and rights boundary

- Selected source: repository-owned Makaron intro render, 15.000s, 1080x1920, 30fps, H.264, silent.
- Rejected candidates: downloaded competitor-ad samples under `docs/meta-swipe-runs`; they are not uploaded to any analysis or generation provider.
- Keep: abstract three-act grammar, timing, hierarchy, negative space, locked camera, stagger rhythm, fades through black.
- Replace: Makaron name/logo, original copy, URL, icons, exact surface styling.

## Part 1 — Skill understanding acceptance

Artifacts: `shot-blueprint.raw.json`, `shot-blueprint.reviewed.json`, `reference-understanding.raw.json`, `reference-contact-sheet.jpg`, and `reference-boundaries.jpg`.

Pass conditions:

- exact file metadata and decodability are measured locally;
- three acts and two transition anchors are supported by FFmpeg evidence plus reviewed frames;
- the false-positive `1.133s` candidate is resolved as internal reveal motion;
- semantic fields say what to preserve and replace rather than copying the surface layer;
- schema and cross-field invariants validate.

## Part 2 — video-model acceptance

- Route: Seedance 2.5 reference-to-video, `operation=generate`, one 15s request, 9:16, 480p, generated audio disabled.
- Why route B: the experiment must test newly generated pixels, not a deterministic text replacement or direct source edit.
- Current official contract checked 2026-08-30: 4-30s; reference video supported; output at 480p; video-reference billing counts input plus output.
- Estimate: `max(15s input, 15s output) + 15s output = 30 billable seconds`; at `$0.084/s`, up to `$2.52`, approximately `171.3 credits` at the published `5.71 credits/s`.
- Retry ceiling: one initial attempt, no blind reroll.

The generated MP4 must decode. Structural QA compares shot count/order, boundary timing, duration curve, transition class, centered/left-aligned composition pattern, locked-camera intent, copy replacement, and final hold. Text spelling, exact stochastic animation paths, and pixel identity cannot be guaranteed.
