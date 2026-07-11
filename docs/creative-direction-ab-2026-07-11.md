# Creative Direction A/B - 2026-07-11

## Goal

Test two independent changes against the same 12-second Makaron script:

1. A reusable creative-direction contract that improves subject-specific visual thinking.
2. A compact Studio Run path that reduces composition size, preview round trips, and failed export loops.

The controlled script was: one idea should not remain trapped in a chat box; Makaron expands it into script, frame, rhythm, review, and a finished film.

## Results

| Run | Creative mode | Total agent time | Steps | Composition code | Preview | Result |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Baseline | `baseline` | 308.4s | 12 | 4,086 chars | one 3-frame contact sheet, 9.0s | completed |
| Directed v1 | `directed` | 576.9s | 13 | 9,915 chars | one 3-frame contact sheet, 7.4s | completed after one code retry |
| Directed v2 | `directed` + compact contract | 480.9s before manual abort | 20+ | 3,990 chars | one 4-frame contact sheet, 10.1s | composition and MP4 completed; stale export status caused repeated retries |
| Direct-payload smoke | compact contract | 46.5s | 4 | 2,032 chars | one 2-frame contact sheet, 8.0s | completed |

Directed v2 reached its valid first composition roughly 95 seconds sooner than directed v1, while cutting source size by about 60%. Its total run was still extended by the export retry bug. The new per-turn circuit breaker stops after two failures for the same unchanged composition.

## Visual Comparison

Baseline project: <http://localhost:3039/projects/a15a3d0b-5166-4af4-a5f1-d616476acfc9>

Baseline MP4: <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/a15a3d0b-5166-4af4-a5f1-d616476acfc9/media/remotion-makaron-brief-film-baseline-b1999b1c.mp4>

Directed v1 project: <http://localhost:3039/projects/8b20ef29-d656-41b2-b7fd-d45112763209>

Directed v1 MP4: <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/8b20ef29-d656-41b2-b7fd-d45112763209/media/remotion-makaron-crystallization-grid-directed-1e687679.mp4>

Directed v2 project: <http://localhost:3039/projects/47f99453-5155-4db1-a8ef-914f8aeebad3>

Directed v2 MP4: <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/47f99453-5155-4db1-a8ef-914f8aeebad3/media/remotion-makaron-directed-v2-box-unfurl-b1b1caae.mp4>

## Assessment

| Axis | Baseline | Directed v1 | Directed v2 |
| --- | ---: | ---: | ---: |
| First-frame recognition | 2/5 | 3/5 | 3/5 |
| Scene distinctness | 1/5 | 4/5 | 4/5 |
| Subject specificity | 2/5 | 4/5 | 4/5 |
| Motion carries meaning | 2/5 | 4/5 | 4/5 |
| Restraint and composition scale | 3/5 | 3/5 | 2/5 |

The creative contract succeeds at replacing generic centered slides with a visual mechanism tied to the subject. It does not yet guarantee strong composition scale: both directed results remain too dark and visually small. The next aesthetic improvement should therefore be a small reusable library of scene archetypes and framing constraints, not more abstract adjectives.

## Acceptance

- [x] Same script tested with and without creative direction.
- [x] Directed proposal stores a machine-readable creative treatment.
- [x] Directed result improves scene distinction, subject specificity, and meaningful motion.
- [x] Composition can be sent directly as structured data without nested executable-code quoting.
- [x] Hook, body, and end frames can be rendered concurrently in one contact sheet.
- [x] Short-form review accepts three representative frames.
- [x] Same unchanged composition cannot trigger more than two export attempts in one agent turn.
- [x] Editable composition and MP4 remain available after export callback failure.
- [ ] Directed visual framing consistently fills the canvas with a strong focal hierarchy.
- [ ] A reusable scene-archetype library reduces directed generation time toward baseline speed.

