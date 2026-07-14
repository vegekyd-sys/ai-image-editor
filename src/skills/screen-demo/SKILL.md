---
name: screen-demo
description: >
  Create an editable product walkthrough from real screen footage or an honest
  synthetic UI or terminal sequence, with readable actions, callouts, captions,
  and optional narration.
allowed-tools: read_file studio_run prepare_visual_asset analyze_video analyze_image transcribe_audio list_voiceover_voices generate_voiceover generate_audio generate_music run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "⌘"
    color: "#e879f9"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "screen-demo"
    studioRunProfile: "capture-or-synthetic"
    sourceMediaRequired: false
    sourceProject: "openmontage"
    sourceSkill: "screen-demo"
    sourceKind: "pipeline"
    supportLevel: "native"
    adapterFamily: "video-workflow"
    canonicalSkill: "screen-demo"
    tags: [video, workflow, studio-run, product-demo, screen, terminal, remotion]
---

# Screen Demo

Use for product walkthroughs, onboarding, tutorials, app flows, websites, and
CLI demos.

## Modes

- `real-capture`: uploaded screen footage is the subject.
- `synthetic-terminal`: deterministic commands, output, progress, and cursor.
- `synthetic-ui`: a truthful simplified product surface when capture is absent.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`, the shared
   taste, audio, review, and Remotion director contracts.
2. Start recipe `screen-demo`; record the mode in the brief and never imply a
   synthetic flow is a real capture.
3. Put the result in the first three seconds: show what the workflow achieves.
4. Script around user actions, not feature claims. Every action needs an
   on-screen moment, readable state change, callout plan, and result.
5. Storyboard crops and zooms conservatively. Keep UI text readable and reserve
   space for captions before adding callouts.
6. Trim dead time and long waits unless timing is itself the lesson. Use cursor
   emphasis and sound sparingly.
7. For terminal/UI synthesis, animate typing, cursor, output, scrolling, and
   state transitions frame by frame in Remotion.
8. Preview the opening result, densest interaction, and ending at final scale;
   then materialize and review.

## Quality Bar

The viewer should be able to repeat the demonstrated workflow. Overlays support
the interface; they do not become the interface.
