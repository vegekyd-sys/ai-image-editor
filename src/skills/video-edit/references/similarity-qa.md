# Video Replication Similarity QA

Acceptance is a vector, never one opaque "looks similar" score. Before
materialization, save available measurements, thresholds, and visual evidence in
the Studio Run Composition artifact. Normalize comparisons to the locked
reference/output FPS and dimensions. Final encoded-file metrics require a
durable post-export verifier; until it exists, mark them `unverified`.

## P0 Gates

| Dimension | Machine measure | Suggested P0 gate |
| --- | --- | --- |
| File truth | proposed post-export FFprobe plus full decode to a null sink | MP4 decodes; expected H.264/AAC or intentional no-audio; duration error <= 1 output frame |
| Shot count/order | matched monotonic boundary sequence | exact count and order for route A; generated shots may be flagged rather than hidden |
| Boundary timing | median and P95 absolute boundary error | median <= 2 frames; P95 <= 5 frames for deterministic edits |
| Duration curve | mean absolute percentage error per matched shot | <= 5% for deterministic edits; report provider-originated misses separately |
| Cut/transition | class match plus transition duration error | exact class for hard cut/fade; duration error <= 3 frames |
| Caption timing/layout | cue start/end error, text box IoU, baseline/size deltas | timing <= 2 frames; IoU >= 0.85 for deterministic overlays |
| Beat alignment | nearest beat/onset distance for locked edit events | median <= 50 ms; P95 <= 100 ms |
| Composition | subject box center/scale, horizon and salient-point deltas | center <= 5% frame diagonal; scale error <= 10% after allowed replacement |
| Camera/motion | global-motion direction, magnitude curve, optical-flow trajectory | direction match and normalized curve correlation >= 0.8 when measurable |
| Color/style | palette distance and luminance/contrast distribution | report Delta E / histogram distance; threshold is project-specific |

For route B/C, calculate structural metrics on the final Remotion timeline and
visual metrics on each generated shot. Do not average away a failed hook,
identity error, broken hand, unreadable caption, or seam discontinuity.

## Repair Loop

1. Classify every miss as `timeline`, `asset_map`, `generated_pixels`,
   `caption`, `audio`, or `file`.
2. Patch timeline/caption/audio/file misses deterministically first.
3. Re-map a source asset before generating a replacement.
4. Re-generate only the failing shot, with the measured delta in the prompt or
   reference plan. One blind reroll is not a correction.
5. Stop the batch when the representative shot fails its threshold or the
   approved attempt/cost ceiling is reached.

## Dimensions That Cannot Be Guaranteed

No current provider can guarantee pixel identity, exact stochastic camera
trajectory, actor performance, occluded geometry, physics, lip-sync, or
sample-accurate music generation from an arbitrary reference. A model also
cannot recover hidden lenses, rigs, edits, or author intent from pixels alone.
Copyright, publicity, trademark, and music rights are legal/provenance gates,
not similarity metrics. Report these limitations instead of converting them
into a false pass score.
