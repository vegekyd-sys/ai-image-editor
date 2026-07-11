---
name: motion-design-video
description: >
  Create motion-first videos using kinetic typography, diagrams, charts,
  illustrative animation, UI motion, and synchronized sound instead of a
  repeated slide or card template.
allowed-tools: read_file studio_run analyze_image analyze_video generate_image generate_audio generate_music list_voiceover_voices generate_voiceover transcribe_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "✦"
    color: "#e879f9"
    tipsEnabled: false
    builtIn: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "motion-design-video"
    studioRunProfile: "local-animation"
    sourceMediaRequired: false
    tags: [video, workflow, studio-run, motion-design, typography, data-viz, remotion]
---

# Motion Design Video

Use for kinetic type, animated diagrams, data stories, logo/title motion,
technical visualizations, illustrative explainers, and motion-led social pieces.

## Modes

- `kinetic-type`: words, scale, rhythm, and sound are the main material.
- `diagram`: systems or processes reveal progressively.
- `data-story`: comparisons and change over time lead the narrative.
- `illustrative`: shapes, image layers, masks, and character-like objects act.
- `ui-motion`: interfaces demonstrate state change without pretending to be a
  real screen recording.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`. Before
   composition, read `prompts/remotion-composition.md` and follow
   `skills/_shared/remotion-director-contract.md`, including its required
   references.
2. Start recipe `motion-design-video`; record the chosen mode in the brief.
3. Offer concepts that differ in visual mechanism, not just typography or
   color. Name the main reveal, motion energy, and final lockup.
4. Script in visual beats with enough hold time to read. For data, simplify to
   the few values needed for the claim and never distort scale.
   A complete branded piece must name its subject, show setup-transformation-
   payoff, and reserve a readable final hold for the exact closing line.
5. Storyboard one dominant event per scene. Avoid repeating one centered card.
6. Build frame-driven Remotion animation with `useCurrentFrame`, interpolation,
   and springs. CSS transitions are not deterministic enough for rendering.
7. Coordinate sound hits with meaningful motion. Unless the user explicitly
   requests a silent video, include narration, music, or designed sound; "no
   narration" does not mean "no audio". Keep subtitles and labels
   inside safe areas at the final aspect ratio.
8. Preview hook, strongest body beat, and final lockup together in one
   `preview_frame` contact sheet before materializing.

## Quality Bar

Motion must reveal hierarchy, causality, comparison, or emotion. If the same
information works just as well as static slides, revise the concept.
Visual execution does not replace storytelling. Reject an attractive visual test
that never names the subject, lacks a payoff, ends mid-action, or has no audio
support without an explicit silent-video request.
