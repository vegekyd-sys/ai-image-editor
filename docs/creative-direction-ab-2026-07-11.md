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

## Theme-Fit V3

Project: <http://localhost:3039/projects/999d82e8-eb9f-4e77-b3c0-64fbac621f81>

MP4 (1080p): <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/999d82e8-eb9f-4e77-b3c0-64fbac621f81/media/remotion-solo-studio-orchestration-03435781.mp4>

The first V3 attempt was aborted after it read the director contracts but spent
too long before starting Studio Run. Candidate comparison was then constrained
to schema fields, integer scores, and one short theme-connection sentence per
concept. The retry completed in 340.9 seconds.

V3 compared three forms without rendering rejected candidates:

| Form | Theme | Recognition | Motion | Efficiency | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| System choreography | 5 | 4 | 5 | 4 | selected |
| Object transformation | 4 | 4 | 4 | 5 | rejected |
| Scale reveal | 4 | 3 | 3 | 4 | rejected |

Planning through Assets completed at 124.2 seconds. The first valid direct
composition landed at 216.4 seconds with 3,060 source characters, so the
post-planning composition interval was 92.2 seconds. This is about 104 seconds
faster than Directed v2's comparable interval. Contact-sheet review took 9.0
seconds and required one call.

The composition is brighter, larger, and more readable than v1/v2. Its person
activating four stations and converging them into a finished screen is more
theme-related than generic text slides. It still fails the stricter visual-noun
test: four colored squares could represent many unrelated products. The
contract now requires at least two subject-native visible cues with motion roles
and rejects `genericShapeRisk`.

The run also exposed a duplicate-export cost. It rendered `fast_720p`, then
rendered 1080p because the delivery promise had locked 1920x1080. The fast path
now locks 1280x720 when speed is requested and resolution is unspecified, or
uses `source` on the first export when a larger promise is explicit.

## Complete Story V4

Project: <http://localhost:3039/projects/67e6ac6a-e1e0-479f-944c-ebd5a1b0e2a7>

MP4: <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/67e6ac6a-e1e0-479f-944c-ebd5a1b0e2a7/media/remotion-makaron-brand-film-15s-38f08988.mp4>

V3 exposed a conceptual regression: the hidden-copy counterfactual was treated
as an instruction to omit semantic copy, and a speed-oriented prompt removed
narration without preserving another audio layer. The result was a visual study,
not a complete Makaron film.

V4 separates the two contracts. Theme-fit imagery must survive a hidden-copy
test, while the delivered film must still name Makaron, complete setup-
transformation-payoff, hold on an intentional final line, and include narrative
audio unless silence is explicitly requested.

The 15.06-second V4 output contains H.264 video and AAC audio at 1280x720 and
30fps. It includes generated Mandarin narration, restrained background music,
semantic Chinese copy, five studio-native visual cues, and a 2.5-second Makaron
final lockup. Contact-sheet review caught generic storyboard/script blocks and
triggered one justified revision before the single publish and export.

The storytelling regression is fixed. Visual craft is not yet finished: the
final contact sheet remains dark and uses too little of the canvas. The next
iteration should focus on framing scale, richer materials, and stronger focal
hierarchy without reopening the narrative contract.

### V4 Timing Ledger

Agent run: `02904379-27a5-49b1-886b-bec43f526cc9`

| Milestone | Elapsed |
| --- | ---: |
| Music ready | 178.9s |
| Voiceover ready | 205.5s |
| Planning and assets persisted | 293.0s |
| First valid composition | 450.9s |
| First contact sheet | 467.7s |
| Revised composition | 574.6s |
| Final contact sheet | 592.0s |
| Published editable composition | 605.5s |
| Export queued | 611.6s |
| Agent response complete | 670.1s wall clock |
| MP4 actually ready | 708.2s wall clock |
| Studio Delivery complete | 775.7s wall clock |

The Lambda render itself took 35.1 seconds; queue delay and the separate
Delivery-finalization turn account for the gap after the Agent response. V4
used two previews and one justified composition revision, then one publish and
one export. This is a quality recovery run, not a speed win: audio generation
and the richer 9,168-character composition made it slower than V3.

## Visual Craft V5 Cold Start

Project: <http://localhost:3039/projects/98bf7c23-f231-43fe-8375-d1db7a46e917>

MP4: <https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/98bf7c23-f231-43fe-8375-d1db7a46e917/media/remotion-composition-3821b2bd.mp4>

V5 was created as a fresh project and cold-start Studio Run. It reused V4's
narration and music URLs as controlled inputs but did not continue editing the
V4 project. Story, copy, duration, audio, and final line were locked; only
framing, canvas use, material depth, contrast hierarchy, and lockup scale were
changed.

The three sampled-frame average luma rose from V4's `18.9/255` to V5's
`151.5/255`. The setup and process frames now use a warm, bright canvas and the
final Makaron wordmark dominates at thumbnail scale. Active paper stacks,
film-strip frames, waveform tracks, and review marks occupy most of the process
frame. The character remains deliberately simple, so illustration craft is
still the next quality ceiling.

The first contact sheet exposed one real defect: the material stack fully
covered the director's head. One revision moved the stack upward while keeping
intentional material occlusion. Full-resolution frame files confirmed the
opening, process, and ending frames were valid; the compact contact sheet alone
was visually ambiguous at its display scale.

### V5 Timing Ledger

Project: `98bf7c23-f231-43fe-8375-d1db7a46e917`

Agent run: `f3891faa-ca42-488d-a541-90646d9a9927`

| Milestone | Elapsed |
| --- | ---: |
| Studio Run started | 28.4s |
| Planning and reused assets persisted | 167.3s |
| First valid composition | 394.9s |
| First contact sheet | 415.4s |
| Targeted middle-frame inspection | 528.7s |
| Revised composition | 673.7s |
| Final contact sheet | 694.3s |
| Review persisted | 779.6s |
| Published editable composition | 785.2s |
| Agent stopped after two export failures | 829.4s wall clock |
| Recovery Lambda MP4 ready | 995.4s wall clock |
| Reusable MP4 promoted to durable workspace media | 10.09s promotion time, no rerender |
| Studio Delivery complete | 1320.3s wall clock |

The recovery render itself took 33.47 seconds. Export recovery exposed a
product bug: a completed non-published job was reused for `--publish` but
retained a temporary Lambda URL. The export harness now promotes the existing
MP4 into the project workspace and timeline without rendering it again.

V5 used one planning batch, two contact sheets, one targeted full frame, one
revision, one publish, and two failed in-run export calls. The later recovery
render and durable promotion are reported separately rather than hidden inside
the successful visual result.
